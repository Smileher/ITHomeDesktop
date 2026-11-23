use crate::{
    error::{AppError, Result},
    models::Profile,
    store::atomic_write,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use url::Url;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
}
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Session {
    pub profile: Profile,
    pub cookies: Vec<SessionCookie>,
}
pub struct Auth {
    value: Mutex<Session>,
    pub generation: AtomicU64,
}

pub fn official_host(host: &str) -> bool {
    ["ithome.com", "ruanmei.com"]
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

impl Auth {
    pub fn load(root: &Path) -> Result<Self> {
        let path = root.join("session.bin");
        let value = match fs::read(path) {
            Ok(bytes) => {
                serde_json::from_slice::<Session>(&protect(&bytes, false)?).map_err(|_| {
                    AppError::new("session", "保存的会话无法读取，请退出账号后重新登录")
                })?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Session::default(),
            Err(e) => return Err(AppError::storage(e)),
        };
        Ok(Self {
            value: Mutex::new(value),
            generation: AtomicU64::new(0),
        })
    }
    pub fn empty() -> Self {
        Self {
            value: Mutex::new(Session::default()),
            generation: AtomicU64::new(0),
        }
    }
    pub fn session(&self) -> Result<Session> {
        Ok(self.value.lock().map_err(AppError::storage)?.clone())
    }
    pub fn profile(&self) -> Result<Profile> {
        Ok(self
            .value
            .lock()
            .map_err(AppError::storage)?
            .profile
            .clone())
    }
    pub fn scope(&self) -> Result<String> {
        Ok(format!("user:{}", self.profile()?.id))
    }
    pub fn replace(&self, root: &Path, value: Session, remember: bool) -> Result<()> {
        let mut current = self.value.lock().map_err(AppError::storage)?;
        if remember {
            atomic_write(
                &root.join("session.bin"),
                &protect(
                    &serde_json::to_vec(&value).map_err(AppError::storage)?,
                    true,
                )?,
            )
            .map_err(AppError::storage)?;
        } else {
            remove_session_file(root)?;
        }
        let changed = current.profile.id != value.profile.id || current.cookies != value.cookies;
        *current = value;
        if changed {
            self.generation.fetch_add(1, Ordering::SeqCst);
        }
        Ok(())
    }
    pub fn cookie_header(&self, url: &Url) -> Result<String> {
        Ok(cookie_header(&self.session()?.cookies, url))
    }
    pub fn ensure_generation(&self, generation: u64) -> Result<()> {
        if self.generation.load(Ordering::SeqCst) != generation {
            Err(AppError::new("session_changed", "账号状态已变化，请重试"))
        } else {
            Ok(())
        }
    }
}
fn remove_session_file(root: &Path) -> Result<()> {
    match fs::remove_file(root.join("session.bin")) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::storage(e)),
    }
}

pub fn cookie_header(cookies: &[SessionCookie], url: &Url) -> String {
    let host = url.host_str().unwrap_or_default();
    if !official_host(host) {
        return String::new();
    }
    let mut matching: Vec<_> = cookies
        .iter()
        .filter(|cookie| {
            let domain = cookie.domain.trim_start_matches('.');
            let host_matches = if cookie.domain.starts_with('.') {
                host == domain || host.ends_with(&format!(".{domain}"))
            } else {
                host == domain
            };
            let path = &cookie.path;
            let path_matches = url.path() == path
                || (url.path().starts_with(path)
                    && (path.ends_with('/')
                        || url.path().as_bytes().get(path.len()) == Some(&b'/')));
            official_host(domain)
                && host_matches
                && path_matches
                && (!cookie.secure || url.scheme() == "https")
                && !cookie.name.contains(['\r', '\n', ';'])
                && !cookie.value.contains(['\r', '\n'])
        })
        .collect();
    matching.sort_by_key(|c| std::cmp::Reverse(c.path.len()));
    matching
        .iter()
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ")
}

#[cfg(windows)]
pub fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let source = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len()).map_err(AppError::storage)?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let success = unsafe {
        if encrypt {
            CryptProtectData(
                &source,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &source,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err(AppError::new(
            "encryption",
            "Windows 会话加密或解密失败；未使用明文保存",
        ));
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData as *mut _);
    }
    Ok(result)
}
#[cfg(not(windows))]
pub fn protect(_: &[u8], _: bool) -> Result<Vec<u8>> {
    Err(AppError::new(
        "unsupported",
        "当前版本仅支持 Windows 加密会话",
    ))
}

pub fn collect_cookies(
    groups: Vec<(String, Vec<tauri::webview::Cookie<'static>>)>,
) -> Vec<SessionCookie> {
    let mut values = BTreeMap::new();
    for (host, cookies) in groups {
        for c in cookies {
            // The cookie crate strips leading dots; bind each browser-filtered result to its exact request host.
            let domain = host.clone();
            if official_host(&domain) {
                let item = SessionCookie {
                    name: c.name().into(),
                    value: c.value().into(),
                    domain,
                    path: c.path().unwrap_or("/").into(),
                    secure: c.secure().unwrap_or(false),
                };
                values.insert(
                    (item.domain.clone(), item.path.clone(), item.name.clone()),
                    item,
                );
            }
        }
    }
    values.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cookies_never_cross_unrelated_hosts_or_path_boundaries() {
        let cookies = vec![SessionCookie {
            name: "session".into(),
            value: "secret".into(),
            domain: ".ithome.com".into(),
            path: "/api".into(),
            secure: true,
        }];
        for url in [
            "https://ithome.com.evil.test/api",
            "https://evilithome.com/api",
            "https://cmt.ithome.com/apix",
            "http://cmt.ithome.com/api",
        ] {
            assert_eq!(cookie_header(&cookies, &Url::parse(url).unwrap()), "");
        }
        assert_eq!(
            cookie_header(
                &cookies,
                &Url::parse("https://cmt.ithome.com/api/comment").unwrap()
            ),
            "session=secret"
        );
    }
    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip_and_invalid_ciphertext() {
        let encrypted = protect(b"private cookie", true).unwrap();
        assert_ne!(encrypted, b"private cookie");
        assert_eq!(protect(&encrypted, false).unwrap(), b"private cookie");
        assert!(protect(b"invalid", false).is_err());
    }
}
