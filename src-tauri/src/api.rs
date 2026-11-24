use crate::{
    auth::{cookie_header, Auth, SessionCookie},
    error::{AppError, Result},
    models::{Article, Cached, NewsItem, Profile},
    store::{now, Store},
};
use reqwest::{
    header::{CONTENT_TYPE, COOKIE, REFERER},
    Client, Response,
};
use scraper::{Html, Selector};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use url::Url;
use des::{cipher::{BlockEncrypt, KeyInit}, Des};

pub const CHANNELS: &[&str] = &[
    "news", "win11", "android", "ios", "digi", "it", "auto", "game",
];
pub struct Api {
    pub client: Client,
    pub store: Arc<Store>,
    pub auth: Arc<Auth>,
    pub writes: tokio::sync::Mutex<()>,
    pub account_credential: tokio::sync::Mutex<Option<crate::account::AccountCredential>>,
}
impl Api {
    pub fn new(store: Arc<Store>, auth: Arc<Auth>) -> Result<Self> {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) ITHomeDesktop/0.1 (Unofficial)")
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(network)?;
        Ok(Self {
            client,
            store,
            auth,
            writes: tokio::sync::Mutex::new(()),
            account_credential: tokio::sync::Mutex::new(None),
        })
    }
    pub async fn get(&self, url: &str) -> Result<Response> {
        let parsed = Url::parse(url).map_err(|_| AppError::new("url", "无效的地址"))?;
        let mut request = self
            .client
            .get(url)
            .header(REFERER, "https://www.ithome.com/");
        let cookies = self.auth.cookie_header(&parsed)?;
        if !cookies.is_empty() {
            request = request.header(COOKIE, cookies);
        }
        check(request.send().await.map_err(network)?)
    }
    pub async fn news(
        &self,
        channel: &str,
        cursor: Option<&str>,
        refresh: bool,
    ) -> Result<Cached<Vec<NewsItem>>> {
        if !CHANNELS.contains(&channel) {
            return Err(AppError::new("channel", "不支持的频道"));
        }
        let key = format!("news:v2:{channel}:{}", cursor.unwrap_or_default());
        let cached = self.store.cache::<Vec<NewsItem>>(&key)?;
        if !refresh {
            if let Some(v) = cached
                .as_ref()
                .filter(|v| now().saturating_sub(v.saved_at) < 120)
            {
                return Ok(v.clone());
            }
        }
        let fetched = async {
            let data: Value = if let Some(cursor) = cursor {
                let mut url = Url::parse("https://m.ithome.com/api/news/newslistpageget").unwrap();
                url.query_pairs_mut()
                    .append_pair("Tag", channel)
                    .append_pair("ot", cursor)
                    .append_pair("page", "1")
                    .append_pair("hitCountAuthority", "false");
                self.get(url.as_str())
                    .await?
                    .json()
                    .await
                    .map_err(network)?
            } else {
                self.get(&format!("https://api.ithome.com/json/newslist/{channel}?r={}", if refresh { now() } else { 0 }))
                    .await?
                    .json()
                    .await
                    .map_err(network)?
            };
            let rows = data
                .get("newslist")
                .or_else(|| data.get("Result"))
                .and_then(Value::as_array)
                .ok_or_else(|| AppError::new("protocol", "资讯响应格式已变化"))?;
            let mut seen = HashSet::new();
            // Pinned entries are a separate official list, never the chronological cursor.
            let pinned = data.get("toplist").and_then(Value::as_array);
            let items: Vec<_> = pinned.into_iter().flatten()
                .filter_map(news_item)
                .map(|mut item| { item.pinned = true; item })
                .chain(rows
                .iter()
                .filter_map(news_item))
                .filter(|item| seen.insert(item.id))
                .collect();
            if items.is_empty() && !rows.is_empty() {
                return Err(AppError::new("protocol", "资讯字段无法识别"));
            }
            self.store.put_cache(&key, &items)?;
            self.trim()?;
            Ok(Cached {
                data: items,
                saved_at: now(),
                stale: false,
            })
        }
        .await;
        if fetched
            .as_ref()
            .err()
            .is_some_and(|e| ["not_found", "forbidden"].contains(&e.code.as_str()))
        {
            self.store.delete_cache(&key)?;
        }
        cache_fallback(fetched, cached)
    }
    pub async fn deals(&self, refresh: bool) -> Result<Cached<Vec<NewsItem>>> {
        let key = "deals:home";
        let cached = self.store.cache::<Vec<NewsItem>>(key)?;
        if !refresh {
            if let Some(value) = cached
                .as_ref()
                .filter(|value| now().saturating_sub(value.saved_at) < 300)
            {
                return Ok(value.clone());
            }
        }
        let fetched = async {
            let html = self
                .get("https://www.ithome.com/")
                .await?
                .text()
                .await
                .map_err(network)?;
            let items = parse_deals(&html)?;
            self.store.put_cache(key, &items)?;
            self.trim()?;
            Ok(Cached {
                data: items,
                saved_at: now(),
                stale: false,
            })
        }
        .await;
        cache_fallback(fetched, cached)
    }
    pub async fn circle(&self, kind: &str, id: u64, page: u32, menu: u64, stamp: &str, refresh: bool) -> Result<Cached<Value>> {
        if page == 0 || page > 500 || stamp.len() > 80 {
            return Err(AppError::new("validation", "圈子分页参数无效"));
        }
        let path = match kind {
            "latest" if [2000000001, 2000000002, 2000000011].contains(&menu) => "/api/home/getnewmenufeeds",
            "recommend" if [2000000012, 2000000003, 2000000004].contains(&menu) => "/api/home/getrecommendedmenufeeds",
            "topic" => "/api/topic/gettopicfeeds",
            "detail" => "/api/content/getcontentdetail",
            "comments" if [0, 1, 2].contains(&menu) => "/api/comment/getcomments",
            "floor" => "/api/comment/getsinglefloorcomment",
            _ => return Err(AppError::new("validation", "不支持的圈子请求")),
        };
        if ["topic", "detail", "comments", "floor"].contains(&kind) { validate_id(id)?; }
        let mut url = Url::parse(&format!("https://qapi.ithome.com{path}")).unwrap();
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("page", &page.to_string()).append_pair("pageSize", "20");
            if ["latest", "recommend"].contains(&kind) {
                query.append_pair("pageId", if kind == "latest" { "2000000004" } else { "2000000002" })
                    .append_pair("flowType", "0").append_pair("menuId", &menu.to_string());
                // The current home feed requires the newer App contract to return posts.
                query.append_pair("appver", "933").append_pair("rawappver", "9.33").append_pair("platform", "ithome_android");
            } else {
                query.append_pair("appver", "799").append_pair("platform", "ithome_uwp");
                match kind {
                    "topic" => { query.append_pair("topicId", &id.to_string()).append_pair("pid", "0").append_pair("menuId", "2000000002"); }
                    "comments" => { query.append_pair("contentId", &id.to_string()).append_pair("current", &page.to_string()).append_pair("sortType", &menu.to_string()); }
                    "floor" => { validate_id(menu)?; query.append_pair("floorCommentId", &id.to_string()).append_pair("contentId", &menu.to_string()); }
                    _ => { query.append_pair("id", &id.to_string()); }
                }
            }
            if !stamp.is_empty() { query.append_pair("stamp", stamp); }
        }
        // Interaction state belongs to the signed-in account and must never enter
        // the shared public cache. Anonymous browsing keeps its existing path.
        if ["detail", "comments", "floor"].contains(&kind) && self.auth.profile()?.id > 0 {
            let (generation, token, _) = self.credential().await?;
            let value = crate::account::response_json(self.account_headers(self.client.get(url.clone()), &url, &token)?).await?;
            self.auth.ensure_generation(generation)?;
            let data = value.get("data").filter(|v| !v.is_null()).cloned()
                .ok_or_else(|| AppError::new("protocol", "圈子响应缺少内容"))?;
            return Ok(Cached { data, saved_at: now(), stale: false });
        }
        let key = format!("circle:public:v1:{kind}:{id}:{page}:{menu}:{stamp}");
        let cached = self.store.cache::<Value>(&key)?;
        if !refresh {
            if let Some(value) = cached.as_ref().filter(|v| now().saturating_sub(v.saved_at) < 60) {
                return Ok(value.clone());
            }
        }
        let fetched = async {
            // Public browsing deliberately sends no account credentials.
            let response = check(self.client.get(url).header(REFERER, "https://quan.ithome.com/").send().await.map_err(network)?)?;
            let value: Value = response.json().await.map_err(network)?;
            if value.get("success") != Some(&Value::Bool(true)) {
                return Err(AppError::new("server_message", value.get("errorMessage").and_then(Value::as_str).unwrap_or("圈子读取失败")));
            }
            let data = value.get("data").filter(|v| !v.is_null()).cloned()
                .ok_or_else(|| AppError::new("protocol", "圈子响应缺少内容"))?;
            self.store.put_cache(&key, &data)?;
            self.trim()?;
            Ok(Cached { data, saved_at: now(), stale: false })
        }.await;
        cache_fallback(fetched, cached)
    }
    pub async fn article(&self, id: u64, refresh: bool) -> Result<Cached<Article>> {
        validate_id(id)?;
        let key = format!("article:{id}");
        let cached = self.store.cache::<Article>(&key)?;
        if !refresh {
            if let Some(v) = cached
                .as_ref()
                .filter(|v| now().saturating_sub(v.saved_at) < 1800)
            {
                return Ok(v.clone());
            }
        }
        let fetched = async {
            let data: Value = self
                .get(&format!("https://api.ithome.com/json/newscontent/{id}"))
                .await?
                .json()
                .await
                .map_err(network)?;
            if data.get("success") == Some(&Value::Bool(false)) {
                return Err(AppError::new("not_found", "文章已移除或不可访问"));
            }
            let item =
                news_item(&data).ok_or_else(|| AppError::new("protocol", "正文响应格式已变化"))?;
            let html = data
                .get("detail")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::new("protocol", "正文内容缺失"))?
                .to_owned();
            let page = self
                .get(&canonical_url(id))
                .await?
                .text()
                .await
                .map_err(network)?;
            let sn = comment_sn(&page).unwrap_or_default();
            let article = Article {
                item,
                html,
                author: text(&data, "newsauthor"),
                source: text(&data, "newssource"),
                sn,
            };
            self.store.put_cache(&key, &article)?;
            self.trim()?;
            Ok(Cached {
                data: article,
                saved_at: now(),
                stale: false,
            })
        }
        .await;
        if fetched
            .as_ref()
            .err()
            .is_some_and(|e| ["not_found", "forbidden"].contains(&e.code.as_str()))
        {
            self.store.delete_cache(&key)?;
        }
        cache_fallback(fetched, cached)
    }
    pub async fn comments(&self, id: u64, cursor: u64, earliest: bool) -> Result<Value> {
        let generation = self.auth.generation.load(Ordering::SeqCst);
        let article = self.article(id, false).await?;
        if article.data.sn.is_empty() {
            return Err(AppError::new(
                "comments",
                "该文章的评论入口暂不可用，可打开官方页面查看",
            ));
        }
        let mut url = Url::parse("https://cmt.ithome.com/api/webcomment/getnewscomment").unwrap();
        url.query_pairs_mut()
            .append_pair("sn", &article.data.sn)
            .append_pair("cid", &cursor.to_string())
            .append_pair("isInit", if cursor == 0 { "true" } else { "false" })
            .append_pair("appver", "900");
        if earliest {
            url.query_pairs_mut().append_pair("latest", "1");
        }
        let data: Value = self
            .get(url.as_str())
            .await?
            .json()
            .await
            .map_err(network)?;
        let mut content = success_content(data)?;
        // The web response omits device tails; the app read endpoint returns the
        // same comments with their official source models. Keep web permissions.
        let tails = tokio::time::timeout(Duration::from_secs(4), self.app_comments(id, cursor, earliest)).await;
        if let Ok(Ok(tails)) = tails {
            enrich_comment_sources(&mut content, &tails);
        }
        self.auth.ensure_generation(generation)?;
        Ok(content)
    }
    async fn app_comments(&self, id: u64, cursor: u64, earliest: bool) -> Result<Value> {
        let mut url = Url::parse("https://cmt.ithome.com/apiv2/comment/getnewscomment").unwrap();
        url.query_pairs_mut()
            .append_pair("sn", &app_comment_sn(id)?)
            .append_pair("appver", "933")
            .append_pair("cid", &cursor.to_string());
        if earliest {
            url.query_pairs_mut().append_pair("latest", "1");
        }
        success_content(self.get(url.as_str()).await?.json().await.map_err(network)?)
    }
    pub async fn children(&self, id: u64, comment: u64) -> Result<Value> {
        let generation = self.auth.generation.load(Ordering::SeqCst);
        let article = self.article(id, false).await?;
        let mut url =
            Url::parse("https://cmt.ithome.com/api/webcomment/getcommentcontent").unwrap();
        url.query_pairs_mut()
            .append_pair("sn", &article.data.sn)
            .append_pair("commentId", &comment.to_string())
            .append_pair("appver", "900");
        let response = self
            .get(url.as_str())
            .await?
            .json::<Value>()
            .await
            .map_err(network)?;
        let mut content = success_content(response)?;
        let mut source_url = Url::parse("https://cmt.ithome.com/apiv2/comment/getcommentcontent").unwrap();
        source_url.query_pairs_mut()
            .append_pair("commentid", &app_comment_sn(comment)?)
            .append_pair("appver", "933");
        if let Ok(response) = self.get(source_url.as_str()).await {
            if let Ok(value) = response.json::<Value>().await {
                if let Ok(source) = success_content(value) {
                    enrich_comment_sources(&mut content, &source);
                }
            }
        }
        self.auth.ensure_generation(generation)?;
        Ok(content)
    }
    pub async fn verify_cookies(&self, cookies: &[SessionCookie], id: u64) -> Result<Profile> {
        let article = self.article(id, false).await?;
        let mut url = Url::parse("https://cmt.ithome.com/api/webcomment/getnewscomment").unwrap();
        url.query_pairs_mut()
            .append_pair("sn", &article.data.sn)
            .append_pair("cid", "0")
            .append_pair("isInit", "true")
            .append_pair("appver", "900");
        let header = cookie_header(cookies, &url);
        if header.is_empty() {
            return Err(AppError::new(
                "login",
                "尚未检测到官方登录会话，请在登录窗口完成登录后再同步",
            ));
        }
        let response = check(
            self.client
                .get(url)
                .header(REFERER, "https://www.ithome.com/")
                .header(COOKIE, header)
                .send()
                .await
                .map_err(network)?,
        )?;
        let data = success_content(response.json().await.map_err(network)?)?;
        let id = data.get("userId").and_then(Value::as_u64).unwrap_or(0);
        let nick = text(&data, "userNick");
        if id == 0 || nick.is_empty() {
            return Err(AppError::new(
                "login",
                "官方会话尚未登录或已失效，请重新登录后同步",
            ));
        }
        Ok(Profile { id, nick })
    }
    pub async fn submit(&self, id: u64, reply: u64, body: &str) -> Result<Value> {
        let _write = self.writes.lock().await;
        if self.store.settings()?.read_only { return Err(AppError::new("readonly", "只读模式已开启，请在设置中关闭后操作")); }
        let generation = self.auth.generation.load(Ordering::SeqCst);
        if self.auth.profile()?.id == 0 {
            return Err(AppError::new("login", "请先登录账号"));
        }
        if body.trim().is_empty() || body.len() > 100_000 {
            return Err(AppError::new("validation", "评论内容为空或过长"));
        }
        let article = self.article(id, false).await?;
        if article.data.item.forbid_comment {
            return Err(AppError::new("forbidden", "该文章已关闭评论"));
        }
        let url = Url::parse("https://cmt.ithome.com/apiv2/comment/submit").unwrap();
        // Follow the official web payload; omit client/device fields so the server chooses the source tail.
        let response=self.client.post(url.clone()).header(COOKIE,self.auth.cookie_header(&url)?).header(REFERER,canonical_url(id)).json(&json!({"newsId":id.to_string(),"elements":[{"type":0,"content":body}],"replyCommentId":reply})).send().await.map_err(|_|AppError::new("uncertain","发送结果待确认，请先刷新评论核对；草稿已保留，不会自动重发"))?;
        let response = check(response)?;
        let data: Value = response.json().await.map_err(|_| {
            AppError::new("uncertain", "发送结果无法解析，请刷新评论核对；草稿已保留")
        })?;
        self.auth.ensure_generation(generation)?;
        if data.get("success") != Some(&Value::Bool(true)) {
            return Err(AppError::new("server_message", text(&data, "message")));
        }
        Ok(data)
    }
    pub async fn vote(&self, id: u64, cancel: bool) -> Result<Value> {
        let _write = self.writes.lock().await;
        if self.store.settings()?.read_only { return Err(AppError::new("readonly", "只读模式已开启，请在设置中关闭后操作")); }
        if self.auth.profile()?.id == 0 {
            return Err(AppError::new("login", "请先登录账号"));
        }
        let generation = self.auth.generation.load(Ordering::SeqCst);
        let action = if cancel { "cancelvote" } else { "vote" };
        let data: Value = self
            .get(&format!(
                "https://cmt.ithome.com/api/comment/{action}?commentid={id}&typeid=1"
            ))
            .await?
            .json()
            .await
            .map_err(network)?;
        self.auth.ensure_generation(generation)?;
        if data.get("success") != Some(&Value::Bool(true)) {
            return Err(AppError::new("server_message", text(&data, "message")));
        }
        Ok(data)
    }
    pub async fn search(&self, keyword: &str) -> Result<Vec<NewsItem>> {
        let keyword = keyword.trim();
        if keyword.is_empty() || keyword.chars().count() > 100 {
            return Err(AppError::new("validation", "请输入 1～100 个字符的关键词"));
        }
        let mut url = Url::parse("https://www.ithome.com/").unwrap();
        url.path_segments_mut()
            .unwrap()
            .push("search")
            .push(&format!("{keyword}.html"));
        let response = self.get(url.as_str()).await?;
        let page = response.text().await.map_err(network)?;
        if page.contains("loginHelper.requestLogin") {
            return Err(AppError::new("login", "官方搜索需要登录，请先登录后重试"));
        }
        parse_search(&page)
    }
    pub fn trim(&self) -> Result<()> {
        let limit = self.store.settings()?.cache_limit_mb as u64 * 1024 * 1024;
        self.store.trim_cache(limit, false)
    }
    pub async fn image(&self, raw: &str) -> Result<String> {
        let url = Url::parse(raw).map_err(|_| AppError::new("image", "图片地址无效"))?;
        let host = url.host_str().unwrap_or_default();
        if url.scheme() != "https"
            || !["ithome.com", "ruanmei.com"]
                .iter()
                .any(|d| host == *d || host.ends_with(&format!(".{d}")))
        {
            return Err(AppError::new("image", "该图片使用原始地址显示"));
        }
        let key = format!("{:x}", Sha256::digest(raw.as_bytes()));
        if let Some(path) = self.store.image_path(&key)? {
            return Ok(path.to_string_lossy().into_owned());
        }
        let mut response = check(
            self.client
                .get(url)
                .header(REFERER, "https://www.ithome.com/")
                .send()
                .await
                .map_err(network)?,
        )?;
        if !response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .starts_with("image/")
        {
            return Err(AppError::new("image", "服务器返回的内容不是图片"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(network)? {
            if bytes.len() + chunk.len() > 20 * 1024 * 1024 {
                return Err(AppError::new("image", "图片超过缓存大小限制"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let path = self.store.save_image(&key, &bytes)?;
        self.trim()?;
        Ok(path.to_string_lossy().into_owned())
    }
}

fn network(error: impl std::fmt::Display) -> AppError {
    let _ = error;
    AppError::new("network", "网络请求未完成，请检查连接后重试")
}
fn check(response: Response) -> Result<Response> {
    let status = response.status().as_u16();
    if (200..300).contains(&status) {
        Ok(response)
    } else {
        Err(match status {
            301 | 302 | 303 | 307 | 308 => {
                AppError::new("login", "官方服务要求登录或跳转，请打开官方页面继续")
            }
            401 => AppError::new("login", "登录已失效，请重新登录"),
            403 => AppError::new("forbidden", "官方服务拒绝了此操作，请在官方页面核对权限"),
            404 => AppError::new("not_found", "内容已移除或不存在"),
            429 => AppError::new("rate_limit", "请求较频繁，请稍后再试"),
            500..=599 => AppError::new("server", "官方服务暂时不可用"),
            _ => AppError::new("http", format!("请求失败（HTTP {status}）")),
        })
    }
}
fn cache_fallback<T>(result: Result<Cached<T>>, cached: Option<Cached<T>>) -> Result<Cached<T>> {
    match result {
        Err(error) if ["network", "server"].contains(&error.code.as_str()) => {
            if let Some(mut cached) = cached {
                cached.stale = true;
                Ok(cached)
            } else {
                Err(error)
            }
        }
        other => other,
    }
}
pub fn canonical_url(id: u64) -> String {
    let value = format!("{id:09}");
    format!(
        "https://www.ithome.com/{}/{}/{}.htm",
        value[0..3]
            .trim_start_matches('0')
            .parse::<u64>()
            .unwrap_or(0),
        &value[3..6],
        &value[6..9]
    )
}
pub fn validate_id(id: u64) -> Result<()> {
    if id == 0 || id > 999_999_999 {
        Err(AppError::new("validation", "内容 ID 无效"))
    } else {
        Ok(())
    }
}
pub fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}
pub fn news_item(value: &Value) -> Option<NewsItem> {
    let id = value.get("newsid")?.as_u64()?;
    let title = text(value, "title");
    if id == 0 || title.is_empty() {
        return None;
    }
    Some(NewsItem {
        id,
        title,
        date: text(value, "postdate"),
        order_date: value
            .get("orderdate")
            .and_then(Value::as_str)
            .unwrap_or_else(|| {
                value
                    .get("postdate")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            })
            .into(),
        summary: text(value, "description"),
        image: text(value, "image"),
        url: canonical_url(id),
        comments: value
            .get("commentcount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        forbid_comment: value
            .get("forbidcomment")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        pinned: false,
        advertisement: value.get("aid").and_then(Value::as_u64).unwrap_or(0) > 0
            || text(value, "NewsTips") == "广告",
        video: value.get("v").is_some_and(|v| !v.is_null() && v != "" && v != "0" && v != 0),
    })
}
pub fn comment_sn(page: &str) -> Option<String> {
    let document = Html::parse_document(page);
    let selector = Selector::parse("#post_comm[data-id]").ok()?;
    let element = document.select(&selector).next()?;
    let value = element.value().attr("data-id")?;
    if value.len() > 128 {
        return None;
    }
    Some(value.into())
}
pub(crate) fn app_comment_sn(id: u64) -> Result<String> {
    validate_id(id)?;
    // Public app wire format: DES/ECB with zero padding encodes a news ID.
    // It is not an account credential and does not grant authentication.
    let cipher = Des::new_from_slice(b"(#i@x*l%")
        .map_err(|_| AppError::new("protocol", "评论编号编码失败"))?;
    let mut bytes = id.to_string().into_bytes();
    bytes.resize(bytes.len().div_ceil(8) * 8, 0);
    for chunk in bytes.chunks_exact_mut(8) {
        cipher.encrypt_block(chunk.into());
    }
    Ok(bytes.iter().map(|value| format!("{value:02x}")).collect())
}
fn enrich_comment_sources(web: &mut Value, app: &Value) {
    fn collect<'a>(value: &'a Value, map: &mut std::collections::HashMap<u64, &'a Value>) {
        if let Some(id) = value.get("id").and_then(Value::as_u64) {
            map.insert(id, value);
        }
        if let Some(array) = value.as_array() {
            for item in array { collect(item, map); }
        } else if let Some(object) = value.as_object() {
            for name in ["comments", "hotComments", "topComments", "children", "comment"] {
                if let Some(children) = object.get(name) { collect(children, map); }
            }
        }
    }
    fn apply(value: &mut Value, map: &std::collections::HashMap<u64, &Value>) {
        if let Some(model) = value.get("id").and_then(Value::as_u64).and_then(|id| map.get(&id)) {
            for key in ["deviceTailModel", "tail", "tailClient", "pictures"] {
                if let Some(source) = model.get(key) { value[key] = source.clone(); }
            }
        }
        if let Some(array) = value.as_array_mut() {
            for item in array { apply(item, map); }
        } else if let Some(object) = value.as_object_mut() {
            for name in ["comments", "hotComments", "topComments", "children", "comment"] {
                if let Some(children) = object.get_mut(name) { apply(children, map); }
            }
        }
    }
    let mut map = std::collections::HashMap::new();
    collect(app, &mut map);
    apply(web, &map);
}
fn parse_deals(page: &str) -> Result<Vec<NewsItem>> {
    let document = Html::parse_document(page);
    let selector = Selector::parse("a[href*='lapin.ithome.com/html/']")
        .map_err(|_| AppError::new("protocol", "好物页面结构已变化"))?;
    let image_selector = Selector::parse("img").unwrap();
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for anchor in document.select(&selector) {
        let href = anchor.value().attr("href").unwrap_or_default();
        let Ok(url) = Url::parse(href) else { continue };
        if url.scheme() != "https" || url.host_str() != Some("lapin.ithome.com") {
            continue;
        }
        let Some(raw_id) = url
            .path_segments()
            .and_then(|segments| segments.last())
            .and_then(|value| value.strip_suffix(".htm"))
        else {
            continue;
        };
        let Ok(id) = raw_id.parse::<u64>() else { continue };
        validate_id(id)?;
        let title = anchor.text().collect::<String>().trim().to_owned();
        if title.is_empty() || !seen.insert(id) {
            continue;
        }
        let image = anchor
            .parent()
            .and_then(scraper::ElementRef::wrap)
            .and_then(|parent| parent.select(&image_selector).next())
            .and_then(|image| image.value().attr("data-src").or_else(|| image.value().attr("src")))
            .map(|value| {
                if value.starts_with("//") {
                    format!("https:{value}")
                } else {
                    value.to_owned()
                }
            })
            .unwrap_or_default();
        items.push(NewsItem {
            id,
            title,
            date: String::new(),
            order_date: String::new(),
            summary: String::new(),
            image,
            url: href.to_owned(),
            comments: 0,
            forbid_comment: false,
            pinned: false,
            advertisement: false,
            video: false,
        });
    }
    if items.is_empty() {
        return Err(AppError::new("protocol", "好物页面未返回可识别内容"));
    }
    Ok(items)
}
fn success_content(value: Value) -> Result<Value> {
    if value.get("success") == Some(&Value::Bool(true)) {
        value
            .get("content")
            .cloned()
            .ok_or_else(|| AppError::new("protocol", "响应缺少内容"))
    } else {
        Err(AppError::new(
            "server_message",
            value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("官方服务未完成请求"),
        ))
    }
}
fn parse_search(page: &str) -> Result<Vec<NewsItem>> {
    let doc = Html::parse_document(page);
    let selector = Selector::parse("a[href]").unwrap();
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for a in doc.select(&selector) {
        let href = a.value().attr("href").unwrap_or_default();
        let Ok(url) = Url::parse("https://www.ithome.com/").unwrap().join(href) else {
            continue;
        };
        if url.host_str() != Some("www.ithome.com") {
            continue;
        }
        let p: Vec<_> = url.path().trim_matches('/').split('/').collect();
        if p.len() != 3 || !p[2].ends_with(".htm") {
            continue;
        }
        let Some(last) = p[2].strip_suffix(".htm") else {
            continue;
        };
        let Ok(id) = format!("{}{}{}", p[0], p[1], last).parse::<u64>() else {
            continue;
        };
        let title = a.text().collect::<String>().trim().to_owned();
        if title.chars().count() < 8 || !seen.insert(id) {
            continue;
        }
        items.push(NewsItem {
            id,
            title,
            date: String::new(),
            order_date: String::new(),
            summary: String::new(),
            image: String::new(),
            url: canonical_url(id),
            comments: 0,
            forbid_comment: false,
            pinned: false,
            advertisement: false,
            video: false,
        });
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn official_news_flags_are_retained_without_title_guessing() {
        let item = news_item(&json!({"newsid":1,"title":"新闻标题","aid":1,"v":"100"})).unwrap();
        assert!(item.advertisement && item.video);
        let ordinary = news_item(&json!({"newsid":2,"title":"优惠广告字样不等于广告标记"})).unwrap();
        assert!(!ordinary.advertisement && !ordinary.video);
    }
    #[test]
    fn canonical_and_sn_match_official_page_shape() {
        assert_eq!(
            canonical_url(1030761),
            "https://www.ithome.com/1/030/761.htm"
        );
        assert_eq!(
            canonical_url(655926),
            "https://www.ithome.com/0/655/926.htm"
        );
        assert_eq!(
            comment_sn("<div data-id='abc123' id='post_comm'></div>"),
            Some("abc123".into())
        );
        assert!(validate_id(1_000_000_000).is_err());
    }
    #[test]
    fn cache_is_never_used_to_hide_removed_or_forbidden_content() {
        let old = Some(Cached {
            data: 1,
            saved_at: 0,
            stale: false,
        });
        assert!(cache_fallback(Err(AppError::new("not_found", "gone")), old.clone()).is_err());
        assert!(cache_fallback(Err(AppError::new("forbidden", "denied")), old.clone()).is_err());
        assert!(
            cache_fallback(Err(AppError::new("network", "offline")), old)
                .unwrap()
                .stale
        );
    }
    #[test]
    fn search_ignores_external_links_and_duplicates() {
        let page="<a href='https://evil.test/1/030/761.htm'>Untrusted article</a><a href='/1/030/761.htm'>微软申请新专利：手柄换摇杆仅需一把螺丝刀</a><a href='/1/030/761.htm'>重复的文章链接和标题</a>";
        assert_eq!(parse_search(page).unwrap().len(), 1);
    }
    #[test]
    fn deals_parse_current_lapin_links_without_fabricating_items() {
        let page = "<a href='https://lapin.ithome.com/html/digi/1030919.htm'>知味观芡实糕 4.9 元</a><a href='https://lapin.ithome.com/html/digi/1030919.htm'>重复</a><a href='https://evil.test/html/digi/1030920.htm'>外部链接</a>";
        let values = parse_deals(page).unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].id, 1030919);
        assert_eq!(values[0].url, "https://lapin.ithome.com/html/digi/1030919.htm");
    }
    #[test]
    fn source_metadata_encoding_and_merge_preserve_web_permissions() {
        assert_eq!(app_comment_sn(1030924).unwrap(), "1b6c5f20ed526627");
        let mut web = json!({"canComment":false,"userId":1,"comments":[{"id":10,"deviceTailModel":null,"children":[{"id":11}]}]});
        let app = json!({"canComment":true,"userId":2,"comments":[{"id":10,"deviceTailModel":{"name":"ThinkBook 14"},"children":[{"id":11,"tail":"Xiaomi 14 Ultra"}]}]});
        enrich_comment_sources(&mut web, &app);
        assert_eq!(web["canComment"], false);
        assert_eq!(web["userId"], 1);
        assert_eq!(web["comments"][0]["deviceTailModel"]["name"], "ThinkBook 14");
        assert_eq!(web["comments"][0]["children"][0]["tail"], "Xiaomi 14 Ultra");
    }
    #[test]
    #[ignore = "Reads live public endpoints and writes cache only to an isolated temporary directory"]
    fn live_deals_and_device_sources() {
        let root = std::env::temp_dir().join(format!(
            "ithome-public-read-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
        ));
        let store = Arc::new(Store::open(root.clone()).unwrap());
        let api = Api::new(store, Arc::new(Auth::empty())).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let result = runtime.block_on(async {
            let deals = api.deals(true).await?;
            assert!(!deals.data.is_empty());
            let comments = api.comments(1030924, 0, false).await?;
            let models = comments["comments"].as_array().unwrap();
            let with_tail = models.iter().filter(|value| value["deviceTailModel"]["name"].as_str().is_some()).count();
            assert!(with_tail > 0, "Expected public source models on the verified sample article");
            println!("Public reads: {} deals, {} comments with official device names", deals.data.len(), with_tail);
            Ok::<(), AppError>(())
        });
        drop(api);
        std::fs::remove_dir_all(&root).unwrap();
        result.unwrap();
    }
}
