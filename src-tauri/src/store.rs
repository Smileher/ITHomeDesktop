use crate::{
    error::{AppError, Result},
    models::{Cached, LocalStats, Settings},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn unsigned(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let number: i64 = row.get(index)?;
    u64::try_from(number).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(e),
        )
    })
}

pub struct Store {
    pub root: PathBuf,
    db: Mutex<Connection>,
    writer: Mutex<()>,
}

impl Store {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(root.join("cache/images")).map_err(AppError::storage)?;
        let db = Connection::open(root.join("data.sqlite3")).map_err(AppError::storage)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(AppError::storage)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, saved INTEGER NOT NULL, accessed INTEGER NOT NULL, bytes INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS items (scope TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(scope,kind,id));
            CREATE TABLE IF NOT EXISTS images (key TEXT PRIMARY KEY, path TEXT NOT NULL, bytes INTEGER NOT NULL, accessed INTEGER NOT NULL);
            PRAGMA user_version=1;").map_err(AppError::storage)?;
        Ok(Self {
            root,
            db: Mutex::new(db),
            writer: Mutex::new(()),
        })
    }
    pub fn settings(&self) -> Result<Settings> {
        let path = self.root.join("settings.json");
        match fs::read(&path) {
            Ok(bytes) => {
                let value: Settings = serde_json::from_slice(&bytes).map_err(|_| {
                    AppError::new(
                        "invalid_settings",
                        "配置文件无法解析；原文件已保留，可在设置中恢复默认",
                    )
                })?;
                value.validate()?;
                Ok(value)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(error) => Err(AppError::storage(error)),
        }
    }
    pub fn save_settings(&self, value: &Settings) -> Result<()> {
        value.validate()?;
        let _lock = self.writer.lock().map_err(AppError::storage)?;
        // Invalid or future-version data requires an explicit reset, never an automatic overwrite.
        if self.root.join("settings.json").exists() {
            self.settings()?;
        }
        atomic_write(
            &self.root.join("settings.json"),
            &serde_json::to_vec_pretty(value).map_err(AppError::storage)?,
        )
        .map_err(AppError::storage)
    }
    pub fn reset_settings(&self) -> Result<Settings> {
        let _lock = self.writer.lock().map_err(AppError::storage)?;
        let path = self.root.join("settings.json");
        if path.exists() {
            fs::copy(
                &path,
                self.root.join(format!("settings.backup.{}.json", now())),
            )
            .map_err(AppError::storage)?;
        }
        let value = Settings::default();
        atomic_write(
            &path,
            &serde_json::to_vec_pretty(&value).map_err(AppError::storage)?,
        )
        .map_err(AppError::storage)?;
        Ok(value)
    }
    pub fn cache<T: DeserializeOwned>(&self, key: &str) -> Result<Option<Cached<T>>> {
        let db = self.db.lock().map_err(AppError::storage)?;
        let row: Option<(String, u64)> = db
            .query_row(
                "SELECT payload,saved FROM cache WHERE key=?1",
                [key],
                |row| Ok((row.get(0)?, unsigned(row, 1)?)),
            )
            .optional()
            .map_err(AppError::storage)?;
        if let Some((payload, saved_at)) = row {
            db.execute(
                "UPDATE cache SET accessed=?2 WHERE key=?1",
                params![key, now() as i64],
            )
            .map_err(AppError::storage)?;
            let data = serde_json::from_str(&payload).map_err(AppError::storage)?;
            Ok(Some(Cached {
                data,
                saved_at,
                stale: false,
            }))
        } else {
            Ok(None)
        }
    }
    pub fn put_cache<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let text = serde_json::to_string(value).map_err(AppError::storage)?;
        self.db.lock().map_err(AppError::storage)?.execute("INSERT INTO cache(key,payload,saved,accessed,bytes) VALUES(?1,?2,?3,?3,?4) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,saved=excluded.saved,accessed=excluded.accessed,bytes=excluded.bytes", params![key,text,now() as i64,i64::try_from(text.len()).map_err(AppError::storage)?]).map_err(AppError::storage)?;
        Ok(())
    }
    pub fn delete_cache(&self, key: &str) -> Result<()> {
        self.db
            .lock()
            .map_err(AppError::storage)?
            .execute("DELETE FROM cache WHERE key=?1", [key])
            .map_err(AppError::storage)?;
        Ok(())
    }
    pub fn list(&self, scope: &str, kind: &str) -> Result<Vec<serde_json::Value>> {
        let db = self.db.lock().map_err(AppError::storage)?;
        let mut statement = db.prepare("SELECT payload FROM items WHERE scope=?1 AND kind=?2 ORDER BY updated DESC LIMIT 2000").map_err(AppError::storage)?;
        let rows = statement
            .query_map(params![scope, kind], |row| row.get::<_, String>(0))
            .map_err(AppError::storage)?;
        rows.map(|row| {
            serde_json::from_str(&row.map_err(AppError::storage)?).map_err(AppError::storage)
        })
        .collect()
    }
    pub fn item(&self, scope: &str, kind: &str, id: &str) -> Result<Option<String>> {
        self.db
            .lock()
            .map_err(AppError::storage)?
            .query_row(
                "SELECT payload FROM items WHERE scope=?1 AND kind=?2 AND id=?3",
                params![scope, kind, id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::storage)
    }
    pub fn put_item<T: Serialize>(
        &self,
        scope: &str,
        kind: &str,
        id: &str,
        value: &T,
    ) -> Result<()> {
        let payload = serde_json::to_string(value).map_err(AppError::storage)?;
        let mut db = self.db.lock().map_err(AppError::storage)?;
        let tx = db.transaction().map_err(AppError::storage)?;
        tx.execute("INSERT INTO items(scope,kind,id,payload,updated) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(scope,kind,id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated",params![scope,kind,id,payload,now() as i64]).map_err(AppError::storage)?;
        if kind == "history" {
            tx.execute("DELETE FROM items WHERE scope=?1 AND kind='history' AND id NOT IN (SELECT id FROM items WHERE scope=?1 AND kind='history' ORDER BY updated DESC LIMIT 2000)",[scope]).map_err(AppError::storage)?;
        }
        tx.commit().map_err(AppError::storage)
    }
    pub fn delete_item(&self, scope: &str, kind: &str, id: &str) -> Result<()> {
        self.db
            .lock()
            .map_err(AppError::storage)?
            .execute(
                "DELETE FROM items WHERE scope=?1 AND kind=?2 AND id=?3",
                params![scope, kind, id],
            )
            .map_err(AppError::storage)?;
        Ok(())
    }
    pub fn clear_kind(&self, scope: &str, kind: &str) -> Result<()> {
        self.db
            .lock()
            .map_err(AppError::storage)?
            .execute(
                "DELETE FROM items WHERE scope=?1 AND kind=?2",
                params![scope, kind],
            )
            .map_err(AppError::storage)?;
        Ok(())
    }
    pub fn stats(&self) -> Result<LocalStats> {
        let db = self.db.lock().map_err(AppError::storage)?;
        let cache_bytes = db.query_row("SELECT (SELECT COALESCE(SUM(bytes),0) FROM cache)+(SELECT COALESCE(SUM(bytes),0) FROM images)",[],|r|unsigned(r,0)).map_err(AppError::storage)?;
        let history_count = db
            .query_row("SELECT COUNT(*) FROM items WHERE kind='history'", [], |r| {
                unsigned(r, 0)
            })
            .map_err(AppError::storage)?;
        let favorites_count = db
            .query_row(
                "SELECT COUNT(*) FROM items WHERE kind='favorite'",
                [],
                |r| unsigned(r, 0),
            )
            .map_err(AppError::storage)?;
        Ok(LocalStats {
            cache_bytes,
            history_count,
            favorites_count,
        })
    }
    pub fn image_path(&self, key: &str) -> Result<Option<PathBuf>> {
        let db = self.db.lock().map_err(AppError::storage)?;
        let name: Option<String> = db
            .query_row("SELECT path FROM images WHERE key=?1", [key], |r| r.get(0))
            .optional()
            .map_err(AppError::storage)?;
        if let Some(name) = name {
            let path = self.root.join("cache/images").join(name);
            if path.is_file() {
                db.execute(
                    "UPDATE images SET accessed=?2 WHERE key=?1",
                    params![key, now() as i64],
                )
                .map_err(AppError::storage)?;
                return Ok(Some(path));
            }
        }
        Ok(None)
    }
    pub fn save_image(&self, key: &str, bytes: &[u8]) -> Result<PathBuf> {
        let path = self.root.join("cache/images").join(key);
        // The cache writer excludes eviction while a completed file is being indexed.
        let _writer = self.writer.lock().map_err(AppError::storage)?;
        atomic_write(&path, bytes).map_err(AppError::storage)?;
        self.db.lock().map_err(AppError::storage)?.execute("INSERT INTO images(key,path,bytes,accessed) VALUES(?1,?1,?2,?3) ON CONFLICT(key) DO UPDATE SET bytes=excluded.bytes,accessed=excluded.accessed",params![key,i64::try_from(bytes.len()).map_err(AppError::storage)?,now() as i64]).map_err(AppError::storage)?;
        Ok(path)
    }
    pub fn trim_cache(&self, limit: u64, clear: bool) -> Result<()> {
        let _writer = self.writer.lock().map_err(AppError::storage)?;
        let mut db = self.db.lock().map_err(AppError::storage)?;
        let total: u64 = db.query_row("SELECT (SELECT COALESCE(SUM(bytes),0) FROM cache)+(SELECT COALESCE(SUM(bytes),0) FROM images)",[],|r|unsigned(r,0)).map_err(AppError::storage)?;
        if !clear && total <= limit {
            return Ok(());
        }
        let records: Vec<(String, String, u64)> = {
            let mut s = db.prepare("SELECT 'image',key,bytes,accessed FROM images UNION ALL SELECT 'response',key,bytes,accessed FROM cache ORDER BY accessed ASC").map_err(AppError::storage)?;
            let rows = s
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, unsigned(r, 2)?)))
                .map_err(AppError::storage)?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(AppError::storage)?
        };
        let mut remaining = total;
        let tx = db.transaction().map_err(AppError::storage)?;
        for (kind, key, bytes) in records {
            if !clear && remaining <= limit {
                break;
            }
            if kind == "image" {
                let path = self.root.join("cache/images").join(&key);
                match fs::remove_file(path) {
                    Ok(()) => (),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                    Err(e) => return Err(AppError::storage(e)),
                }
                tx.execute("DELETE FROM images WHERE key=?1", [&key])
                    .map_err(AppError::storage)?;
            } else {
                tx.execute("DELETE FROM cache WHERE key=?1", [&key])
                    .map_err(AppError::storage)?;
            }
            remaining = remaining.saturating_sub(bytes);
        }
        tx.commit().map_err(AppError::storage)
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let temporary = path.with_extension(format!(
        "{}.{}.pending",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
            };
            let from: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            if unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error());
            }
        }
        #[cfg(not(windows))]
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "ithome-store-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn cache_clear_preserves_settings_favorites_and_scoped_drafts() {
        let path = root();
        let store = Store::open(path.clone()).unwrap();
        let settings = Settings {
            font_size: 20,
            ..Settings::default()
        };
        store.save_settings(&settings).unwrap();
        store
            .put_item("local", "favorite", "1", &serde_json::json!({"id":1}))
            .unwrap();
        store.put_item("user:1", "draft", "1:0", &"draft").unwrap();
        store.put_cache("news", &vec![1]).unwrap();
        store.save_image("abc", b"image").unwrap();
        store.trim_cache(0, true).unwrap();
        assert_eq!(store.stats().unwrap().cache_bytes, 0);
        assert_eq!(store.settings().unwrap().font_size, 20);
        assert_eq!(store.list("local", "favorite").unwrap().len(), 1);
        assert!(store.item("user:2", "draft", "1:0").unwrap().is_none());
        assert!(store.item("user:1", "draft", "1:0").unwrap().is_some());
        drop(store);
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn failed_validation_and_corruption_do_not_overwrite_original() {
        let path = root();
        let store = Store::open(path.clone()).unwrap();
        store.save_settings(&Settings::default()).unwrap();
        let before = fs::read(path.join("settings.json")).unwrap();
        assert!(store
            .save_settings(&Settings {
                font_size: 0,
                ..Settings::default()
            })
            .is_err());
        assert_eq!(before, fs::read(path.join("settings.json")).unwrap());
        fs::write(path.join("settings.json"), b"broken").unwrap();
        assert!(store.settings().is_err());
        assert_eq!(fs::read(path.join("settings.json")).unwrap(), b"broken");
        store.reset_settings().unwrap();
        assert!(fs::read_dir(&path).unwrap().any(|p| p
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("backup")));
        drop(store);
        fs::remove_dir_all(path).unwrap();
    }
}
