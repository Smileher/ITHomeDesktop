use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    pub theme: String,
    pub font_size: u16,
    pub compact: bool,
    pub show_images: bool,
    pub cache_limit_mb: u32,
    pub remember_login: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            theme: "system".into(),
            font_size: 17,
            compact: true,
            show_images: true,
            cache_limit_mb: 512,
            remember_login: false,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> crate::error::Result<()> {
        if self.version != 1
            || !["system", "light", "dark"].contains(&self.theme.as_str())
            || !(14..=24).contains(&self.font_size)
            || !(64..=2048).contains(&self.cache_limit_mb)
        {
            return Err(crate::error::AppError::new(
                "invalid_settings",
                "配置版本或参数无效，原文件未被覆盖",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub id: u64,
    pub title: String,
    pub date: String,
    pub order_date: String,
    pub summary: String,
    pub image: String,
    pub url: String,
    pub comments: u64,
    pub forbid_comment: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Article {
    pub item: NewsItem,
    pub html: String,
    pub author: String,
    pub source: String,
    pub sn: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cached<T> {
    pub data: T,
    pub saved_at: u64,
    pub stale: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: u64,
    pub nick: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: Settings,
    pub profile: Profile,
    pub channel: String,
    pub version: String,
    pub warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStats {
    pub cache_bytes: u64,
    pub history_count: u64,
    pub favorites_count: u64,
}
