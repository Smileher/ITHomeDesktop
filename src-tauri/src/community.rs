use crate::{account::response_json, api::{validate_id, Api}, error::{AppError, Result}};
use serde_json::{json, Value};
use url::Url;

impl Api {
    pub async fn badge_counts(&self) -> Result<Value> {
        if self.auth.profile()?.id == 0 { return Ok(json!({"comments":0,"posts":0,"messages":0})); }
        let (generation, token, _) = self.credential().await?;
        let id = self.auth.profile()?.id;
        let encoded = crate::api::app_comment_sn(id)?.to_ascii_uppercase();
        let url = Url::parse(&format!("https://cmt.ithome.com/api/commentnotify/{encoded}")).unwrap();
        let value = response_json(self.account_headers(self.client.get(url.clone()), &url, &token)?).await?;
        let data = value.get("data").unwrap_or(&value);
        let count = |name: &str| -> Result<u64> {
            data.get(name).and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .ok_or_else(|| AppError::new("protocol", "未读计数响应格式已变化"))
        };
        let comments = count("Rcc")?;
        let posts = count("Rrc")?;
        let unread = self.message_data("unread", 0, 1, 0, "").await?;
        self.auth.ensure_generation(generation)?;
        Ok(json!({"comments":comments,"posts":posts,"messages":unread.get("totalCount").and_then(Value::as_u64).unwrap_or(0)}))
    }

    pub async fn message_read(&self, kind: &str, id: i32) -> Result<()> {
        let _write = self.writes.lock().await;
        if self.store.settings()?.read_only { return Err(AppError::new("readonly", "只读模式下保留官方未读状态")); }
        let (generation, token, hash) = self.credential().await?;
        let encoded = crate::api::app_comment_sn(self.auth.profile()?.id)?.to_ascii_uppercase();
        let mut url = match kind {
            "news-replies" => Url::parse(&format!("https://cmt.ithome.com/api/commentnotifyclear/{encoded}")).unwrap(),
            "circle-replies" => Url::parse(&format!("https://cmt.ithome.com/api/replynotifyclear/{encoded}")).unwrap(),
            "conversation" if id != 0 => Url::parse(&format!("https://chat.ithome.com/api/message/read?anotherUserId={id}&appver=1.0&platform=windows")).unwrap(),
            _ => return Err(AppError::new("validation", "已读类型无效")),
        };
        if kind == "conversation" { url.query_pairs_mut().append_pair("userhash", if hash.is_empty() { &token } else { &hash }); }
        // Mark only the opened category/conversation; never clear unrelated messages.
        let response = self.account_headers(self.client.get(url.clone()), &url, &token)?.send().await.map_err(|_| AppError::new("network", "已读状态未同步，请稍后刷新"))?;
        if !response.status().is_success() { return Err(AppError::new("server", "官方服务未确认已读状态")); }
        let text = response.text().await.map_err(AppError::storage)?;
        if serde_json::from_str::<Value>(&text).ok().is_some_and(|v| v["success"] == false) {
            return Err(AppError::new("server", "官方服务未确认已读状态"));
        }
        self.auth.ensure_generation(generation)
    }

    pub async fn pushed_news(&self, date: &str) -> Result<Vec<Value>> {
        let parts: Vec<_> = date.split('-').collect();
        if parts.len() != 3 || parts[0].len() != 4 || date.len() > 10 || !date.chars().all(|c| c.is_ascii_digit() || c == '-') {
            return Err(AppError::new("validation", "推送日期无效"));
        }
        let mut url = Url::parse("https://napi.ithome.com/api/news/getdaypushednewsfeed").unwrap();
        url.query_pairs_mut().append_pair("date", date);
        let value = response_json(self.client.get(url)).await?;
        let list = value["data"]["list"].as_array().ok_or_else(|| AppError::new("protocol", "官方推送列表格式已变化"))?;
        Ok(list.iter().filter_map(|row| {
            let post = &row["feedContent"];
            let id = post["id"].as_u64()?;
            let title = post["title"].as_str()?;
            if validate_id(id).is_err() || title.is_empty() { return None; }
            Some(json!({"id":id,"title":title,"summary":post["newsMemo"].as_str().unwrap_or(""),"image":post["images"][0].as_str().unwrap_or("")}))
        }).collect())
    }

    pub async fn device_tail(&self, mode: &str) -> Result<Value> {
        let device = crate::desktop::tail_device(mode)?;
        let url = Url::parse("https://cmt.ithome.com/api/devicetail/getdeviceinfo").unwrap();
        let value = response_json(
            self.client
                .post(url.clone())
                .header(reqwest::header::REFERER, "https://www.ithome.com/")
                .header("Origin", "https://www.ithome.com")
                .json(&json!({ "client": 10, "device": device })),
        ).await?;
        let data = value.get("data").or_else(|| value.get("content")).or_else(|| value.get("result")).cloned().unwrap_or(value);
        Ok(json!({"official":data,"detectedModel":crate::desktop::detected_model(),"submittedDevice":device}))
    }

    pub async fn message_data(&self, kind: &str, id: i32, page: u32, cursor: u64, stamp: &str) -> Result<Value> {
        if page == 0 || page > 500 || stamp.len() > 100 || stamp.contains(['\r', '\n']) {
            return Err(AppError::new("validation", "消息分页参数无效"));
        }
        let endpoint = match kind {
            "conversations" => "https://chat.ithome.com/api/conversation/getconversations",
            "unread" => "https://chat.ithome.com/api/message/getnotreadcount",
            "conversation" => "https://chat.ithome.com/api/message/getmessages",
            "news-replies" => "https://cmt.ithome.com/apiv2/comment/getreplymecommentlist",
            "circle-replies" => "https://qapi.ithome.com/api/comment/getreplymecomments",
            _ => return Err(AppError::new("validation", "消息类型无效")),
        };
        let (generation, token, hash) = self.credential().await?;
        let mut url = Url::parse(endpoint).unwrap();
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("userhash", if hash.is_empty() { &token } else { &hash });
            match kind {
                "conversation" => {
                    if id == 0 { return Err(AppError::new("validation", "会话 ID 无效")); }
                    query.append_pair("anotherUserId", &id.to_string()).append_pair("pageSize", "20");
                    if !stamp.is_empty() { query.append_pair("lastTime", stamp); }
                }
                "news-replies" => { query.append_pair("appver", "932").append_pair("rawappver", "9.32").append_pair("platform", "ithome_android").append_pair("lessthanid", &cursor.to_string()); }
                "circle-replies" => { query.append_pair("appver", "937").append_pair("rawappver", "9.37").append_pair("platform", "ithome_android").append_pair("page", &page.to_string()).append_pair("pageSize", "20"); }
                _ => {}
            }
        }
        let value = response_json(self.account_headers(self.client.get(url.clone()), &url, &token)?).await?;
        self.auth.ensure_generation(generation)?;
        // Messages are account-private: keep them out of the public disk cache.
        Ok(value.get("data").or_else(|| value.get("content")).filter(|v| !v.is_null()).unwrap_or(&value).clone())
    }

    pub async fn circle_action(&self, kind: &str, id: u64, reply: u64, topic: u64, body: &str, enabled: bool) -> Result<Value> {
        let (path, mut payload) = circle_request(kind, id, reply, topic, body, enabled)?;
        let _write = self.writes.lock().await;
        if self.store.settings()?.read_only {
            return Err(AppError::new("readonly", "只读模式已开启，请在设置中关闭后操作"));
        }
        if ["post", "reply"].contains(&kind) {
            if let Some(device) = crate::desktop::tail_device(&self.store.settings()?.device_tail_mode)? {
                payload["device"] = json!(device);
                payload["ithomeCommentClient"] = json!(10);
            }
        }
        let (generation, token, _) = self.credential().await?;
        let mut url = Url::parse(&format!("https://qapi.ithome.com{path}")).unwrap();
        url.query_pairs_mut().append_pair("appver", "799").append_pair("platform", "ithome_uwp");
        if kind == "favorite" { url.query_pairs_mut().append_pair("id", &id.to_string()); }
        let request = self.account_headers(self.client.post(url.clone()), &url, &token)?.json(&payload);
        // Publish once. An uncertain response must never cause automatic reposts.
        let response = request.send().await.map_err(|_| AppError::new("uncertain", "操作结果待确认，请先刷新核对；草稿已保留，不会自动重发"))?;
        if !response.status().is_success() {
            return Err(AppError::new("server_message", "官方服务未完成操作，请检查账号权限并刷新核对"));
        }
        let value: Value = response.json().await.map_err(|_| AppError::new("uncertain", "操作结果无法解析，请刷新核对；草稿已保留"))?;
        self.auth.ensure_generation(generation)?;
        if value.get("success") != Some(&Value::Bool(true)) {
            return Err(AppError::new("server_message", value.get("errorMessage").or_else(|| value.get("message")).and_then(Value::as_str).unwrap_or("官方服务未完成操作")));
        }
        Ok(value)
    }
}

fn circle_request(kind: &str, id: u64, reply: u64, topic: u64, body: &str, enabled: bool) -> Result<(&'static str, Value)> {
    if kind != "post" { validate_id(id)?; }
    if ["post", "reply"].contains(&kind) && (body.trim().is_empty() || body.len() > 100_000) {
        return Err(AppError::new("validation", "内容为空或过长"));
    }
    // Follow the official content schema; omit client/device fields so the
    // service supplies the actual tail. No device impersonation or custom tail.
    let contents = json!([{ "type": 0, "content": body.trim() }]);
    Ok(match kind {
        "post" => {
            validate_id(topic)?;
            if id != 0 { return Err(AppError::new("validation", "新帖 ID 无效")); }
            let millis = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(AppError::storage)?.as_millis();
            ("/api/content/postmicroblog", json!({"id":0,"location":null,"whoCanSee":0,"contents":contents,"topicId":topic,"timeStamp":millis,"bigImage":false}))
        }
        "reply" => {
            if reply > 0 { validate_id(reply)?; }
            ("/api/comment/postcomment", json!({"contentId":id,"replyCommentId":reply,"location":null,"whoCanSee":0,"contents":contents}))
        }
        "vote-post" => ("/api/content/vote", json!({"contentId":id,"voteType":if enabled {1} else {0}})),
        "vote-comment" => ("/api/comment/vote", json!({"commentId":id,"voteType":if enabled {1} else {0}})),
        "favorite" => (if enabled {"/api/content/star"} else {"/api/content/unstar"}, json!({})),
        _ => return Err(AppError::new("validation", "圈子操作无效")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn community_requests_keep_content_and_reply_identity_distinct() {
        let (_, post) = circle_request("post", 0, 0, 4030, "正文", true).unwrap();
        assert!(post.get("device").is_none() && post.get("ithomeCommentClient").is_none());
        let (_, reply) = circle_request("reply", 917306, 6789375, 0, "回复", true).unwrap();
        assert_eq!(reply["contentId"], 917306);
        assert_eq!(reply["replyCommentId"], 6789375);
        assert!(circle_request("post", 1, 0, 4030, "正文", true).is_err());
        assert!(circle_request("post", 0, 0, 0, "正文", true).is_err());
        assert!(circle_request("reply", 917306, 0, 0, " ", true).is_err());
        assert!(circle_request("unknown", 1, 0, 0, "", true).is_err());
    }
    #[test]
    fn circle_writes_enforce_readonly_and_login_before_network() {
        tauri::async_runtime::block_on(async {
            use crate::{auth::Auth, models::Settings, store::Store};
            use std::sync::Arc;
            let root = std::env::temp_dir().join(format!("ithome-circle-guard-{}", std::process::id()));
            let store = Arc::new(Store::open(root.clone()).unwrap());
            let api = Api::new(store.clone(), Arc::new(Auth::load(&root).unwrap())).unwrap();
            let mut settings = Settings::default();
            settings.read_only = true;
            store.save_settings(&settings).unwrap();
            assert_eq!(api.message_read("news-replies", 0).await.unwrap_err().code, "readonly");
            for (kind, id, topic, body) in [("post", 0, 4030, "测试"), ("reply", 917306, 0, "测试"), ("vote-post", 917306, 0, ""), ("vote-comment", 6789375, 0, ""), ("favorite", 917306, 0, "")] {
                assert_eq!(api.circle_action(kind, id, 0, topic, body, true).await.unwrap_err().code, "readonly");
            }
            settings.read_only = false;
            store.save_settings(&settings).unwrap();
            assert_eq!(api.circle_action("post", 0, 0, 4030, "测试", true).await.unwrap_err().code, "login");
            assert_eq!(api.message_read("news-replies", 0).await.unwrap_err().code, "login");
            drop(api); drop(store);
            let _ = std::fs::remove_dir_all(root);
        });
    }
    #[test]
    #[ignore = "Reads account-private endpoints without mutations; prints response field names only"]
    fn live_message_contracts() {
        tauri::async_runtime::block_on(async {
            use crate::{auth::Auth, store::Store};
            use std::sync::Arc;
            let root = std::env::temp_dir().join(format!("ithome-message-probe-{}", std::process::id()));
            let session = std::env::var("ITHOME_ACCOUNT_SESSION_DIR").unwrap();
            let api = Api::new(Arc::new(Store::open(root.clone()).unwrap()), Arc::new(Auth::load(std::path::Path::new(&session)).unwrap())).unwrap();
            let badges = api.badge_counts().await.unwrap();
            println!("badge fields: {:?}", badges.as_object().unwrap().keys().collect::<Vec<_>>());
            let tail = api.device_tail("windows").await.unwrap();
            assert!(tail["official"]["deviceName"].is_string());
            println!("official tail preview: string; local model available={}", crate::desktop::detected_model().is_some());
            let pushed = api.pushed_news("2026-11-25").await.unwrap();
            assert!(!pushed.is_empty());
            println!("official push feed: readable; image_present={}", pushed.iter().any(|v| v["image"].as_str().is_some_and(|s| !s.is_empty())));
            for kind in ["unread", "conversations", "news-replies", "circle-replies"] {
                match api.message_data(kind, 0, 1, 0, "").await {
                    Ok(data) => {
                        let rows = data.as_array().or_else(|| data.get("list").and_then(Value::as_array));
                        println!("{kind}: keys={:?}; first_fields={:?}", data.as_object().map(|o| o.keys().collect::<Vec<_>>()), rows.and_then(|r| r.first()).and_then(Value::as_object).map(|o| o.keys().collect::<Vec<_>>()));
                        if kind == "news-replies" {
                            println!("news-replies contracts: null_comments={}; comment_fields={:?}; news_fields={:?}", rows.map(|r| r.iter().filter(|v| !v["comment"].is_object()).count()).unwrap_or(0), rows.and_then(|r| r.iter().find_map(|v| v["comment"].as_object())).map(|o| o.keys().collect::<Vec<_>>()), rows.and_then(|r| r.iter().find_map(|v| v["news"].as_object())).map(|o| o.keys().collect::<Vec<_>>()));
                            println!("news-replies edge counts: zero_id={}; nontext_elements={}; null_user={}", rows.map(|r| r.iter().filter(|v| v["comment"]["id"].as_u64().unwrap_or(0) == 0).count()).unwrap_or(0), rows.map(|r| r.iter().filter(|v| v["comment"]["elements"].as_array().is_some_and(|a| a.iter().any(|e| !e["content"].is_null() && !e["content"].is_string()))).count()).unwrap_or(0), rows.map(|r| r.iter().filter(|v| !v["comment"]["userInfo"].is_object()).count()).unwrap_or(0));
                        }
                        if kind == "conversations" {
                            if let Some(id) = rows.and_then(|r| r.first()).and_then(|r| r.get("anotherUserId")).and_then(Value::as_i64) {
                                println!("conversation identity: signed integer, system={}", id < 0);
                                match api.message_data("conversation", i32::try_from(id).unwrap(), 1, 0, "").await {
                                    Ok(messages) => println!("conversation: keys={:?}; array_count={:?}; first_fields={:?}", messages.as_object().map(|o| o.keys().collect::<Vec<_>>()), messages.as_array().map(Vec::len), messages.as_array().and_then(|r| r.first()).and_then(Value::as_object).map(|o| o.keys().collect::<Vec<_>>())),
                                    Err(error) => println!("conversation: {}", error.message),
                                }
                            }
                        }
                    }
                    Err(error) => println!("{kind}: {}", error.message),
                }
            }
            drop(api);
            let _ = std::fs::remove_dir_all(root);
        });
    }
}
