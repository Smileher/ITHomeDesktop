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
    pub article_images: bool,
    pub read_only: bool,
    pub ui_font: String,
    pub body_font: String,
    pub line_height: f64,
    pub auto_open_article: bool,
    pub show_comment_composer: bool,
    pub pinned_card: bool,
    pub circle_grid: bool,
    pub validate_session_on_start: bool,
    pub device_tail_mode: String,
    pub notifications_enabled: bool,
    #[serde(default = "default_true")]
    pub notify_news: bool,
    #[serde(default = "default_true")]
    pub notify_replies: bool,
    pub notify_messages: bool,
}
fn default_true() -> bool { true }
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
            article_images: true,
            read_only: false,
            ui_font: "system".into(),
            body_font: "system".into(),
            line_height: 1.9,
            auto_open_article: true,
            show_comment_composer: true,
            pinned_card: true,
            circle_grid: true,
            validate_session_on_start: true,
            device_tail_mode: "official".into(),
            notifications_enabled: false,
            notify_news: true,
            notify_replies: true,
            notify_messages: false,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> crate::error::Result<()> {
        if self.version != 1
            || !["system", "light", "dark"].contains(&self.theme.as_str())
            || !(14..=24).contains(&self.font_size)
            || !(64..=2048).contains(&self.cache_limit_mb)
            || !["system", "Microsoft YaHei UI", "SimSun", "Segoe UI"].contains(&self.ui_font.as_str())
            || !["system", "Microsoft YaHei UI", "SimSun", "Segoe UI"].contains(&self.body_font.as_str())
            || !self.line_height.is_finite() || !(1.5..=2.4).contains(&self.line_height)
            || !["official", "windows", "detected"].contains(&self.device_tail_mode.as_str())
        {
            return Err(crate::error::AppError::new(
                "invalid_settings",
                "配置版本或参数无效，原文件未被覆盖",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn old_settings_keep_existing_preferences_and_disable_new_notifications() {
        let settings: super::Settings = serde_json::from_str(r#"{"theme":"dark","rememberLogin":true,"fontSize":19}"#).unwrap();
        assert_eq!(settings.theme, "dark");
        assert!(settings.remember_login);
        assert_eq!(settings.font_size, 19);
        assert_eq!(settings.device_tail_mode, "official");
        assert!(!settings.notifications_enabled);
        assert!(settings.notify_news && settings.notify_replies);
        assert!(settings.validate().is_ok());
        let mut invalid = settings;
        invalid.device_tail_mode = "arbitrary phone".into();
        assert!(invalid.validate().is_err());
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
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub advertisement: bool,
    #[serde(default)]
    pub video: bool,
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
