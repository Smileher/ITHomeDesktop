use crate::{
    api::{validate_id, Api},
    auth::official_host,
    error::{AppError, Result},
    store::now,
};
use reqwest::{
    header::{COOKIE, REFERER},
    RequestBuilder,
};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use url::Url;

// Short-lived credentials remain in native memory; the existing DPAPI cookie session is unchanged.
pub struct AccountCredential {
    generation: u64,
    saved_at: u64,
    token: String,
    hash: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_values_reject_non_tokens() {
        assert_eq!(token_value("not-a-token"), None);
        assert_eq!(
            token_value("Bearer eyJtest.payload.signature"),
            Some("eyJtest.payload.signature".into())
        );
        assert_eq!(token_value("eyJtest.payload.signature%0AInjected"), None);
    }
    #[test]
    #[ignore = "Read-only verification using an explicitly supplied local session directory; never prints account data"]
    fn live_account_reads() {
        tauri::async_runtime::block_on(async {
            use crate::{auth::Auth, store::Store};
            use std::sync::Arc;
            let session_root =
                std::env::var("ITHOME_ACCOUNT_SESSION_DIR").expect("session directory required");
            let task_root =
                std::env::temp_dir().join(format!("ithome-account-check-{}", std::process::id()));
            let api = Api::new(
                Arc::new(Store::open(task_root.clone()).unwrap()),
                Arc::new(Auth::load(std::path::Path::new(&session_root)).unwrap()),
            )
            .unwrap();
            for kind in [
                "favorites",
                "blacklist",
                "comments",
                "posts",
                "starred-posts",
                "following",
            ] {
                let result = api.account_data(kind, 1, 0).await;
                match result {
                    Ok(data) => {
                        let rows = data
                            .as_array()
                            .or_else(|| data.get("list").and_then(Value::as_array));
                        println!(
                            "{kind}: ok; keys={:?}; array_count={:?}; item_keys={:?}",
                            data.as_object().map(|v| v.keys().collect::<Vec<_>>()),
                            rows.map(Vec::len),
                            rows.and_then(|v| v.first())
                                .and_then(Value::as_object)
                                .map(|v| v.keys().collect::<Vec<_>>())
                        );
                    }
                    Err(error) => println!("{kind}: {}", error.message),
                }
            }
            drop(api);
            let _ = std::fs::remove_dir_all(task_root);
        });
    }
}
fn failure() -> AppError {
    AppError::new("network", "账号服务连接失败，请稍后重试")
}
fn decode(value: &str) -> String {
    url::form_urlencoded::parse(format!("v={value}").as_bytes())
        .next()
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default()
}
fn token_value(value: &str) -> Option<String> {
    let decoded = decode(value);
    let token = decoded
        .trim()
        .trim_matches('"')
        .strip_prefix("Bearer ")
        .unwrap_or(decoded.trim().trim_matches('"'));
    (token.starts_with("eyJ")
        && token.split('.').count() == 3
        && !token.contains(['\r', '\n', ' ']))
    .then(|| token.to_owned())
}
async fn response_json(request: RequestBuilder) -> Result<Value> {
    let response = request.send().await.map_err(|_| failure())?;
    if [401, 403].contains(&response.status().as_u16()) {
        return Err(AppError::new("login", "官方授权已失效，请重新登录后重试"));
    }
    if !response.status().is_success() {
        return Err(failure());
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| AppError::new("protocol", "账号响应格式已变化"))?;
    if value.get("success") == Some(&Value::Bool(false)) || value.get("state") == Some(&json!(0)) {
        return Err(AppError::new(
            "server_message",
            value
                .get("errorMessage")
                .or_else(|| value.get("message"))
                .or_else(|| value.get("msg"))
                .and_then(Value::as_str)
                .unwrap_or("官方服务未完成请求"),
        ));
    }
    Ok(value)
}
impl Api {
    pub async fn user_data(&self, kind: &str, id: u64, page: u32, cursor: u64) -> Result<Value> {
        validate_id(id)?;
        if page == 0 || page > 500 {
            return Err(AppError::new("validation", "用户主页分页无效"));
        }
        let raw = match kind {
            "profile" => format!("https://napi.ithome.com/api/user/gui?suid={}&appver=930&rawappver=9.30&platform=ithome_android", crate::api::app_comment_sn(id)?),
            "posts" => format!("https://qapi.ithome.com/api/content/getusercontents?userId={id}&page={page}&pageSize=20&appver=937&rawappver=9.37&platform=ithome_android"),
            "replies" => format!("https://qapi.ithome.com/api/comment/getusercomments?userid={id}&page={page}&appver=937&rawappver=9.37&platform=ithome_android"),
            "comments" => format!("https://cmt.ithome.com/apiv2/comment/getotherusercommentlist?userID={}&lessthanID={cursor}&appver=932&rawappver=9.32&platform=ithome_android", crate::api::app_comment_sn(id)?.to_ascii_uppercase()),
            _ => return Err(AppError::new("validation", "用户主页内容无效")),
        };
        let mut url = Url::parse(&raw).map_err(AppError::storage)?;
        let generation = self.auth.generation.load(Ordering::SeqCst);
        let request = if ["comments", "replies"].contains(&kind) {
            let (_, token, hash) = self.credential().await?;
            url.query_pairs_mut().append_pair("userhash", if kind == "comments" && !hash.is_empty() { &hash } else { &token });
            self.account_headers(self.client.get(url.clone()), &url, &token)?
        } else {
            self.client.get(url).header(REFERER, "https://www.ithome.com/")
        };
        let value = response_json(request).await?;
        self.auth.ensure_generation(generation)?;
        if kind == "profile" {
            if !value.get("nickname").is_some_and(Value::is_string) {
                return Err(AppError::new("protocol", "用户资料响应格式已变化"));
            }
            return Ok(value);
        }
        value.get("data").or_else(|| value.get("content")).filter(|v| !v.is_null())
            .cloned().ok_or_else(|| AppError::new("protocol", "用户主页响应缺少内容"))
    }

    async fn credential(&self) -> Result<(u64, String, String)> {
        let generation = self.auth.generation.load(Ordering::SeqCst);
        let session = self.auth.session()?;
        if session.profile.id == 0 {
            return Err(AppError::new("login", "请先登录账号"));
        }
        let mut cached = self.account_credential.lock().await;
        if let Some(value) = cached
            .as_ref()
            .filter(|v| v.generation == generation && now().saturating_sub(v.saved_at) < 600)
        {
            return Ok((generation, value.token.clone(), value.hash.clone()));
        }
        let cookies: Vec<_> = session
            .cookies
            .iter()
            .filter(|cookie| official_host(cookie.domain.trim_start_matches('.')))
            .collect();
        let hash = cookies
            .iter()
            .filter(|cookie| cookie.name.eq_ignore_ascii_case("user"))
            .find_map(|cookie| {
                url::form_urlencoded::parse(decode(&cookie.value).as_bytes())
                    .find(|(key, _)| key.eq_ignore_ascii_case("hash"))
                    .map(|(_, value)| value.into_owned())
            })
            .unwrap_or_default();
        let mut token = cookies
            .iter()
            .filter(|cookie| {
                [
                    "jwtuser",
                    "user_token",
                    "usertoken",
                    "token",
                    "jwt",
                    "accesstoken",
                    "access_token",
                ]
                .contains(&cookie.name.to_lowercase().as_str())
            })
            .find_map(|cookie| token_value(&cookie.value));
        if token.is_none() && !hash.is_empty() {
            let value = response_json(
                self.client
                    .post("https://myapi.ruanmei.com/api/user/loginbyuserhash?extra=ithome_wap")
                    .header(REFERER, "https://my.ruanmei.com/user-login/index.htm")
                    .json(&json!({ "userhash": hash })),
            )
            .await?;
            token = value
                .get("content")
                .and_then(|v| v.get("token"))
                .and_then(Value::as_str)
                .and_then(token_value);
        }
        let token = token
            .ok_or_else(|| AppError::new("login", "当前会话缺少官方账号授权，请重新扫码登录"))?;
        self.auth.ensure_generation(generation)?;
        *cached = Some(AccountCredential {
            generation,
            saved_at: now(),
            token: token.clone(),
            hash: hash.clone(),
        });
        Ok((generation, token, hash))
    }
    fn account_headers(
        &self,
        request: RequestBuilder,
        url: &Url,
        token: &str,
    ) -> Result<RequestBuilder> {
        let origin = if url.host_str() == Some("qapi.ithome.com") {
            "https://quan.ithome.com"
        } else {
            "https://www.ithome.com"
        };
        Ok(request
            .bearer_auth(token)
            .header("userhash", format!("Bearer {token}"))
            .header("appver", "900")
            .header("platform", "windows")
            .header("Origin", origin)
            .header(REFERER, format!("{origin}/"))
            .header(COOKIE, self.auth.cookie_header(url)?))
    }
    pub async fn account_data(&self, kind: &str, page: u32, cursor: u64) -> Result<Value> {
        if page == 0 || page > 500 {
            return Err(AppError::new("validation", "账号分页无效"));
        }
        let (generation, token, hash) = self.credential().await?;
        let endpoint = match kind {
            "favorites" => "https://napi.ithome.com/api/favnews/get",
            "blacklist" => "https://napi.ithome.com/api/userselfblock/getblockusers",
            "comments" => "https://cmt.ithome.com/apiv2/comment/getusercommentlist",
            "posts" => "https://qapi.ithome.com/api/content/getmycontents",
            "starred-posts" => "https://qapi.ithome.com/api/content/getstaredcontents",
            "following" => "https://qapi.ithome.com/api/user/getfollowedusers",
            _ => return Err(AppError::new("validation", "账号功能无效")),
        };
        let mut url = Url::parse(endpoint).unwrap();
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("page", &page.to_string())
                .append_pair("pageSize", "20");
            if kind == "comments" {
                query
                    .append_pair("userhash", if hash.is_empty() { &token } else { &hash })
                    .append_pair("lessthanid", &cursor.to_string())
                    .append_pair("appver", "932")
                    .append_pair("rawappver", "9.32")
                    .append_pair("platform", "ithome_android");
            } else if ["posts", "starred-posts", "following"].contains(&kind) {
                query
                    .append_pair("userhash", &format!("Bearer {token}"))
                    .append_pair("appver", "937")
                    .append_pair("rawappver", "9.37")
                    .append_pair("platform", "ithome_android");
            }
        }
        let value =
            response_json(self.account_headers(self.client.get(url.clone()), &url, &token)?)
                .await?;
        self.auth.ensure_generation(generation)?;
        let data = value
            .get("data")
            .or_else(|| value.get("content"))
            .filter(|v| !v.is_null())
            .ok_or_else(|| AppError::new("protocol", "账号响应缺少内容"))?;
        Ok(data.clone())
    }
    pub async fn account_action(&self, kind: &str, id: u64) -> Result<()> {
        validate_id(id)?;
        let _write = self.writes.lock().await;
        if self.store.settings()?.read_only {
            return Err(AppError::new(
                "readonly",
                "只读模式已开启，请在设置中关闭后操作",
            ));
        }
        let (generation, token, _) = self.credential().await?;
        let url = match kind {
            "favorite-add" => "https://napi.ithome.com/api/favnews/addlist".to_owned(),
            "favorite-remove" => "https://napi.ithome.com/api/favnews/deletelist".to_owned(),
            "block" => format!("https://napi.ithome.com/api/userselfblock/create?userId={id}"),
            "unblock" => format!("https://napi.ithome.com/api/userselfblock/delete?userId={id}"),
            _ => return Err(AppError::new("validation", "账号操作无效")),
        };
        let url = Url::parse(&url).unwrap();
        let request = if kind.starts_with("favorite-") {
            self.client
                .post(url.clone())
                .json(&json!({ "newsids": [id] }))
        } else {
            self.client.get(url.clone())
        };
        // Mutation requests run once; an uncertain network result must be checked before retrying.
        let response = self
            .account_headers(request, &url, &token)?
            .send()
            .await
            .map_err(|_| AppError::new("uncertain", "操作结果待确认，请刷新列表核对后再重试"))?;
        if !response.status().is_success() {
            return Err(AppError::new(
                "server_message",
                "官方服务未完成操作，请刷新核对",
            ));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| AppError::new("uncertain", "操作结果无法解析，请刷新列表核对"))?;
        self.auth.ensure_generation(generation)?;
        let success = value.get("success") == Some(&Value::Bool(true))
            || value.get("state") == Some(&json!(1))
            || value
                .get("msg")
                .and_then(Value::as_str)
                .is_some_and(|message| message.contains("成功"));
        if !success {
            return Err(AppError::new(
                "server_message",
                value
                    .get("errorMessage")
                    .or_else(|| value.get("message"))
                    .or_else(|| value.get("msg"))
                    .and_then(Value::as_str)
                    .unwrap_or("官方服务未完成操作"),
            ));
        }
        Ok(())
    }
}
