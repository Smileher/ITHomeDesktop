use crate::error::{AppError, Result};

#[cfg(windows)]
pub fn detected_model() -> Option<String> {
    use std::sync::OnceLock;
    use windows::{core::w, Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ}};
    static MODEL: OnceLock<Option<String>> = OnceLock::new();
    MODEL.get_or_init(|| unsafe {
        let mut buffer = [0u16; 256];
        let mut bytes = (buffer.len() * 2) as u32;
        if RegGetValueW(HKEY_LOCAL_MACHINE, w!("HARDWARE\\DESCRIPTION\\System\\BIOS"), w!("SystemProductName"), RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&mut bytes)).is_err() { return None; }
        let value = String::from_utf16_lossy(&buffer[..buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len())]).trim().to_owned();
        let lower = value.to_ascii_lowercase();
        if value.is_empty() || ["to be filled", "default string", "system product", "virtual machine", "virtualbox", "vmware", "qemu"].iter().any(|s| lower.contains(s)) { None } else { Some(value) }
    }).clone()
}
#[cfg(not(windows))]
pub fn detected_model() -> Option<String> { None }

pub fn tail_device(mode: &str) -> Result<Option<String>> {
    match mode {
        "official" => Ok(None),
        "windows" => Ok(Some("Windows".into())),
        "detected" => detected_model().map(Some).ok_or_else(|| AppError::new("device", "未能识别有效本机型号，请使用 Windows 客户端尾巴")),
        _ => Err(AppError::new("validation", "机型尾巴选项无效")),
    }
}

fn xml_text(value: &str) -> String {
    value.chars().filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t')).map(|c| match c {
        '&' => "&amp;".into(), '<' => "&lt;".into(), '>' => "&gt;".into(), '"' => "&quot;".into(), '\'' => "&apos;".into(), _ => c.to_string(),
    }).collect()
}
fn toast_xml(title: &str, body: &str, image: Option<&str>, target: &str) -> String {
    let image = image.map(|path| format!("<image placement=\"hero\" src=\"{}\"/>", xml_text(path))).unwrap_or_default();
    format!("<toast launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text>{image}</binding></visual></toast>", xml_text(target), xml_text(title), xml_text(body))
}

#[cfg(windows)]
pub fn show_notice(app: &tauri::AppHandle, title: &str, body: &str, image: Option<&str>, target: &str) -> Result<()> {
    use tauri::{Emitter, Manager};
    use windows::{core::{w, HSTRING, IInspectable}, Data::Xml::Dom::XmlDocument, Foundation::TypedEventHandler,
        UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager},
        Win32::{System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ}, UI::Shell::SetCurrentProcessExplicitAppUserModelID}};
    let notifier = if option_env!("ITHOME_STORE_BUILD") == Some("1") {
        ToastNotificationManager::CreateToastNotifier()
    } else {
        (|| -> windows::core::Result<_> {
        // Register only our own identity; never borrow IT Home's Store identity.
        let name: Vec<u16> = "IT之家第三方客户端\0".encode_utf16().collect();
        let icon: Vec<u16> = std::env::current_exe().map_err(|_| windows::core::Error::new(windows::core::HRESULT(0x80004005u32 as i32), "无法定位本应用图标"))?.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
        unsafe {
            RegSetKeyValueW(HKEY_CURRENT_USER, w!("Software\\Classes\\AppUserModelId\\com.smileher.ithomedesktop"), w!("DisplayName"), REG_SZ.0, Some(name.as_ptr().cast()), (name.len()*2) as u32).ok()?;
            RegSetKeyValueW(HKEY_CURRENT_USER, w!("Software\\Classes\\AppUserModelId\\com.smileher.ithomedesktop"), w!("IconUri"), REG_SZ.0, Some(icon.as_ptr().cast()), (icon.len()*2) as u32).ok()?;
            SetCurrentProcessExplicitAppUserModelID(w!("com.smileher.ithomedesktop"))?;
        }
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.smileher.ithomedesktop"))
        })()
    }.map_err(|_| AppError::new("notification", "Windows 通知初始化失败，请安装后重试并核对系统通知设置"))?;
    match notifier.Setting() {
        Ok(setting) if setting != NotificationSetting::Enabled => return Err(AppError::new("notification", "Windows 已关闭本应用通知，请在系统通知设置中开启")),
        Ok(_) => {},
        // A newly registered unpackaged identity may have no settings record yet.
        // Show still goes through the Windows notification service and its policy.
        Err(error) if option_env!("ITHOME_STORE_BUILD") != Some("1") && error.code().0 == 0x80070490u32 as i32 => {},
        Err(error) => return Err(AppError::new("notification", format!("读取 Windows 通知权限失败：{error}"))),
    }
    let document = XmlDocument::new().map_err(|e| AppError::new("notification", format!("初始化通知内容失败：{e}")))?;
    document.LoadXml(&HSTRING::from(toast_xml(title, body, image, target))).map_err(AppError::storage)?;
    let toast = ToastNotification::CreateToastNotification(&document).map_err(|e| AppError::new("notification", format!("创建通知失败：{e}")))?;
    let handle = app.clone();
    let target = target.to_owned();
    toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
        if let Some(main) = handle.get_webview_window("main") { let _ = main.show(); let _ = main.set_focus(); }
        let _ = handle.emit("notification-open", &target);
        Ok(())
    })).map_err(AppError::storage)?;
    notifier.Show(&toast).map_err(|_| AppError::new("notification", "Windows 未能显示通知，请检查通知权限"))?;
    thread_local! { static ACTIVE: std::cell::RefCell<std::collections::VecDeque<ToastNotification>> = const { std::cell::RefCell::new(std::collections::VecDeque::new()) }; }
    ACTIVE.with(|items| { let mut items = items.borrow_mut(); items.push_back(toast); while items.len() > 12 { items.pop_front(); } });
    Ok(())
}
#[cfg(not(windows))]
pub fn show_notice(_: &tauri::AppHandle, _: &str, _: &str, _: Option<&str>, _: &str) -> Result<()> {
    Err(AppError::new("notification", "此构建暂不支持系统通知"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn toast_content_cannot_inject_markup_or_activation() {
        let value = super::toast_xml("A&B<标题>", "<script>bad</script>", Some("file:///C:/a&b.png"), "news:1\"bad");
        assert!(value.contains("A&amp;B&lt;标题&gt;"));
        assert!(!value.contains("<script>"));
        assert!(value.contains("news:1&quot;bad"));
        assert!(value.contains("placement=\"hero\""));
    }
}
