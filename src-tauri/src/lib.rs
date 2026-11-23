mod api;
mod auth;
mod error;
mod models;
mod store;

use api::{canonical_url, Api};
use auth::{Auth, Session};
use error::{AppError, Result};
use models::{Article, Bootstrap, Cached, LocalStats, NewsItem, Profile, Settings};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

struct AppState {
    api: Arc<Api>,
    warnings: Vec<String>,
}
fn local(window: &WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(AppError::new("permission", "仅允许本地应用窗口执行该操作"))
    }
}

#[tauri::command]
fn bootstrap(window: WebviewWindow, state: State<'_, AppState>) -> Result<Bootstrap> {
    local(&window)?;
    let mut warnings = state.warnings.clone();
    let settings = state.api.store.settings().unwrap_or_else(|e| {
        warnings.push(e.message);
        Settings::default()
    });
    Ok(Bootstrap {
        settings,
        profile: state.api.auth.profile()?,
        channel: if option_env!("ITHOME_STORE_BUILD") == Some("1") {
            "store"
        } else {
            "standalone"
        }
        .into(),
        version: env!("CARGO_PKG_VERSION").into(),
        warnings,
    })
}
#[tauri::command]
async fn get_news(
    window: WebviewWindow,
    state: State<'_, AppState>,
    channel: String,
    cursor: Option<String>,
    refresh: bool,
) -> Result<Cached<Vec<NewsItem>>> {
    local(&window)?;
    state.api.news(&channel, cursor.as_deref(), refresh).await
}
#[tauri::command]
async fn get_article(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: u64,
    refresh: bool,
) -> Result<Cached<Article>> {
    local(&window)?;
    let value = state.api.article(id, refresh).await?;
    state
        .api
        .store
        .put_item("local", "history", &id.to_string(), &value.data.item)?;
    Ok(value)
}
#[tauri::command]
async fn get_comments(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: u64,
    cursor: u64,
    earliest: bool,
) -> Result<Value> {
    local(&window)?;
    state.api.comments(id, cursor, earliest).await
}
#[tauri::command]
async fn get_children(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: u64,
    comment: u64,
) -> Result<Value> {
    local(&window)?;
    state.api.children(id, comment).await
}
#[tauri::command]
async fn submit_comment(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: u64,
    reply: u64,
    body: String,
) -> Result<Value> {
    local(&window)?;
    state.api.submit(id, reply, &body).await
}
#[tauri::command]
async fn vote_comment(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: u64,
    cancel: bool,
) -> Result<Value> {
    local(&window)?;
    state.api.vote(id, cancel).await
}
#[tauri::command]
async fn search_news(
    window: WebviewWindow,
    state: State<'_, AppState>,
    keyword: String,
) -> Result<Vec<NewsItem>> {
    local(&window)?;
    state.api.search(&keyword).await
}
#[tauri::command]
fn local_items(
    window: WebviewWindow,
    state: State<'_, AppState>,
    kind: String,
) -> Result<Vec<Value>> {
    local(&window)?;
    if !["favorite", "history"].contains(&kind.as_str()) {
        return Err(AppError::new("validation", "记录类型无效"));
    }
    state.api.store.list("local", &kind)
}
#[tauri::command]
fn toggle_favorite(
    window: WebviewWindow,
    state: State<'_, AppState>,
    item: NewsItem,
    enabled: bool,
) -> Result<()> {
    local(&window)?;
    api::validate_id(item.id)?;
    if enabled {
        state
            .api
            .store
            .put_item("local", "favorite", &item.id.to_string(), &item)
    } else {
        state
            .api
            .store
            .delete_item("local", "favorite", &item.id.to_string())
    }
}
#[tauri::command]
fn get_draft(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: u64,
    reply: u64,
) -> Result<String> {
    local(&window)?;
    let value =
        state
            .api
            .store
            .item(&state.api.auth.scope()?, "draft", &format!("{id}:{reply}"))?;
    value
        .map(|v| serde_json::from_str(&v).map_err(AppError::storage))
        .unwrap_or(Ok(String::new()))
}
#[tauri::command]
fn save_draft(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: u64,
    reply: u64,
    body: String,
    account: u64,
) -> Result<()> {
    local(&window)?;
    if state.api.auth.profile()?.id != account {
        return Err(AppError::new(
            "session_changed",
            "账号已变化，草稿未写入其他账号",
        ));
    }
    if body.len() > 100_000 {
        return Err(AppError::new("validation", "草稿过长"));
    }
    let scope = format!("user:{account}");
    let key = format!("{id}:{reply}");
    if body.is_empty() {
        state.api.store.delete_item(&scope, "draft", &key)
    } else {
        state.api.store.put_item(&scope, "draft", &key, &body)
    }
}
#[tauri::command]
async fn save_settings(
    window: WebviewWindow,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings> {
    local(&window)?;
    let _write = state.api.writes.lock().await;
    settings.validate()?;
    let previous = state.api.store.settings()?;
    state
        .api
        .store
        .trim_cache(settings.cache_limit_mb as u64 * 1024 * 1024, false)?;
    state.api.store.save_settings(&settings)?;
    let session = state.api.auth.session()?;
    if session.profile.id > 0 {
        if let Err(error) =
            state
                .api
                .auth
                .replace(&state.api.store.root, session, settings.remember_login)
        {
            state
                .api
                .store
                .save_settings(&previous)
                .map_err(|rollback| {
                    AppError::new(
                        "storage",
                        format!("{}；配置恢复失败：{}", error.message, rollback.message),
                    )
                })?;
            return Err(error);
        }
    }
    Ok(settings)
}
#[tauri::command]
fn reset_settings(window: WebviewWindow, state: State<'_, AppState>) -> Result<Settings> {
    local(&window)?;
    let value = state.api.store.reset_settings()?;
    state
        .api
        .auth
        .replace(&state.api.store.root, state.api.auth.session()?, false)?;
    Ok(value)
}
#[tauri::command]
fn get_stats(window: WebviewWindow, state: State<'_, AppState>) -> Result<LocalStats> {
    local(&window)?;
    state.api.store.stats()
}
#[tauri::command]
async fn clear_data(window: WebviewWindow, state: State<'_, AppState>, kind: String) -> Result<()> {
    local(&window)?;
    let store = state.api.store.clone();
    let scope = state.api.auth.scope()?;
    tokio::task::spawn_blocking(move || match kind.as_str() {
        "cache" => store.trim_cache(0, true),
        "history" => store.clear_kind("local", "history"),
        "draft" => store.clear_kind(&scope, "draft"),
        _ => Err(AppError::new("validation", "不支持的数据清理类型")),
    })
    .await
    .map_err(AppError::storage)?
}
#[tauri::command]
async fn cache_image(
    window: WebviewWindow,
    state: State<'_, AppState>,
    url: String,
) -> Result<String> {
    local(&window)?;
    state.api.image(&url).await
}
#[tauri::command]
async fn save_image(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<bool> {
    local(&window)?;
    let path = state.api.image(&url).await?;
    let Some(destination) = app
        .dialog()
        .file()
        .set_title("保存图片")
        .set_file_name("ithome-image.jpg")
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let destination = destination.into_path().map_err(AppError::storage)?;
    std::fs::copy(path, destination).map_err(AppError::storage)?;
    Ok(true)
}
#[tauri::command]
fn open_external(window: WebviewWindow, app: AppHandle, url: String) -> Result<()> {
    local(&window)?;
    let parsed = Url::parse(&url).map_err(AppError::storage)?;
    if !["https", "http"].contains(&parsed.scheme())
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(AppError::new("url", "只允许打开 HTTP/HTTPS 链接"));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(AppError::storage)
}

#[tauri::command]
async fn open_official(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
    id: Option<u64>,
    query: Option<String>,
) -> Result<()> {
    local(&window)?;
    let raw = match kind.as_str() {
        "login" => {
            "https://www.ithome.com/user-login/index.htm?url=https%3A%2F%2Fwww.ithome.com%2F"
                .to_owned()
        }
        "circle" => "https://quan.ithome.com/".into(),
        "deals" => "https://lapin.ithome.com/".into(),
        "profile" | "messages" => "https://my.ruanmei.com/".into(),
        "article" => {
            let id = id.ok_or_else(|| AppError::new("validation", "文章 ID 缺失"))?;
            api::validate_id(id)?;
            canonical_url(id)
        }
        "search" => {
            let query = query.unwrap_or_default();
            if query.trim().is_empty() || query.chars().count() > 100 {
                return Err(AppError::new("validation", "搜索词无效"));
            }
            let mut u = Url::parse("https://www.ithome.com/").unwrap();
            u.path_segments_mut()
                .unwrap()
                .push("search")
                .push(&format!("{}.html", query.trim()));
            u.to_string()
        }
        _ => return Err(AppError::new("validation", "官方入口无效")),
    };
    let url = Url::parse(&raw).map_err(AppError::storage)?;
    if let Some(existing) = app.get_webview_window("official") {
        existing.navigate(url).map_err(AppError::storage)?;
        existing.show().map_err(AppError::storage)?;
        existing.set_focus().map_err(AppError::storage)?;
        return Ok(());
    }
    let size=window.inner_size().map_err(AppError::storage)?;
    let scale=window.scale_factor().map_err(AppError::storage)?;
    let remote = WebviewWindowBuilder::new(&app, "official", WebviewUrl::External(url))
        .title("IT之家官方页面 · 由第三方客户端打开")
        .inner_size((size.width as f64/scale).clamp(360.0,1050.0),(size.height as f64/scale).clamp(500.0,780.0))
        .incognito(true)
        .on_navigation(|url| {
            url.scheme() == "https" && url.host_str().is_some_and(auth::official_host)
        })
        .build()
        .map_err(AppError::storage)?;
    for cookie in state.api.auth.session()?.cookies {
        let value = tauri::webview::Cookie::build((cookie.name, cookie.value))
            .domain(cookie.domain)
            .path(cookie.path)
            .secure(cookie.secure)
            .build();
        remote.set_cookie(value).map_err(AppError::storage)?;
    }
    Ok(())
}
#[tauri::command]
async fn sync_login(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
    remember: bool,
    id: u64,
) -> Result<Profile> {
    local(&window)?;
    let _write = state.api.writes.lock().await;
    let remote = app
        .get_webview_window("official")
        .ok_or_else(|| AppError::new("login", "请先打开官方登录窗口"))?;
    let mut groups = Vec::new();
    for raw in [
        "https://www.ithome.com/",
        "https://cmt.ithome.com/api/webcomment/getnewscomment",
        "https://napi.ithome.com/api/user/getuserinfo",
        "https://my.ruanmei.com/",
        "https://myapi.ruanmei.com/api/user/checkloginstatus",
        "https://lapin.ithome.com/",
        "https://quan.ithome.com/",
    ] {
        let url = Url::parse(raw).unwrap();
        let cookies = remote
            .cookies_for_url(url.clone())
            .map_err(AppError::storage)?;
        groups.push((url.host_str().unwrap().to_owned(), cookies));
    }
    let cookies = auth::collect_cookies(groups);
    let profile = state.api.verify_cookies(&cookies, id).await?;
    let previous = state.api.store.settings()?;
    let mut settings = previous.clone();
    settings.remember_login = remember;
    state.api.store.save_settings(&settings)?;
    if let Err(error) = state.api.auth.replace(
        &state.api.store.root,
        Session {
            profile: profile.clone(),
            cookies,
        },
        remember,
    ) {
        state
            .api
            .store
            .save_settings(&previous)
            .map_err(|rollback| {
                AppError::new(
                    "storage",
                    format!("{}；配置恢复失败：{}", error.message, rollback.message),
                )
            })?;
        return Err(error);
    }
    remote.close().map_err(AppError::storage)?;
    Ok(profile)
}
#[tauri::command]
async fn logout(window: WebviewWindow, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    local(&window)?;
    let _write = state.api.writes.lock().await;
    state
        .api
        .auth
        .replace(&state.api.store.root, Session::default(), false)?;
    if let Some(remote) = app.get_webview_window("official") {
        remote.close().map_err(AppError::storage)?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let store = Arc::new(
                store::Store::open(app.path().app_local_data_dir()?).map_err(|e| e.message)?,
            );
            let mut warnings = Vec::new();
            let auth = Arc::new(Auth::load(&store.root).unwrap_or_else(|error| {
                warnings.push(error.message);
                Auth::empty()
            }));
            let api = Arc::new(Api::new(store, auth).map_err(|e| e.message)?);
            app.manage(AppState { api, warnings });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            get_news,
            get_article,
            get_comments,
            get_children,
            submit_comment,
            vote_comment,
            search_news,
            local_items,
            toggle_favorite,
            get_draft,
            save_draft,
            save_settings,
            reset_settings,
            get_stats,
            clear_data,
            cache_image,
            save_image,
            open_external,
            open_official,
            sync_login,
            logout
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 IT之家第三方客户端");
}
