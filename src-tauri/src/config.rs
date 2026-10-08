use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::util::atomic_write;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendConfig {
    pub id: String,
    pub label: String,
    /// Protocol adapter identifier. Both adapters currently use the H3 HTTP contract.
    pub kind: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub ssh_target: Option<String>,
    #[serde(default)]
    pub start_command: Option<String>,
    #[serde(default)]
    pub stop_command: Option<String>,
    #[serde(default)]
    pub modes: Vec<String>,
}

fn sol_h3_backend(base_url: String, api_key: Option<String>) -> BackendConfig {
    BackendConfig {
        id: "sol_h3".into(),
        label: "Sol-H3 Spark".into(),
        kind: "sol_h3".into(),
        base_url,
        api_key,
        ssh_target: Some("spark".into()),
        start_command: Some("/home/nvidia/sol-h3-runtime/bin/workbench-sol-h3 start".into()),
        stop_command: Some("/home/nvidia/sol-h3-runtime/bin/workbench-sol-h3 stop".into()),
        modes: vec!["t2va".into(), "fl2va".into()],
    }
}

fn gb10_backend() -> BackendConfig {
    BackendConfig {
        id: "gb10".into(),
        label: "GB10".into(),
        kind: "gb10".into(),
        base_url: "http://100.64.52.42:30020".into(),
        api_key: None,
        ssh_target: Some("nvidia@100.64.52.42".into()),
        start_command: Some("/home/nvidia/gb10-runtime/bin/workbench-gb10 start".into()),
        stop_command: Some("/home/nvidia/gb10-runtime/bin/workbench-gb10 stop".into()),
        modes: vec!["t2va".into(), "fl2va".into()],
    }
}

/// 用户可配置项（设置对话框）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    /// 任务完成后自动下载 MP4 到本地归档（默认开启，防 H3 重启后文件丢失）。
    #[serde(default = "default_true")]
    pub auto_archive: bool,
    /// Ref2VA 独立服务地址（可选；未配置时参考生成模式不可用）。
    #[serde(default)]
    pub ref2va_base_url: Option<String>,
    /// Ref2VA 服务 API Key（可选；未配置时沿用 api_key）。
    #[serde(default)]
    pub ref2va_api_key: Option<String>,
    /// Selected generation backend. Legacy base_url remains as a migration source.
    #[serde(default = "default_backend_id")]
    pub active_backend_id: String,
    #[serde(default)]
    pub backends: Vec<BackendConfig>,
}

fn default_backend_id() -> String {
    "sol_h3".into()
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "http://127.0.0.1:30010".into(),
            api_key: None,
            auto_archive: true,
            ref2va_base_url: None,
            ref2va_api_key: None,
            active_backend_id: default_backend_id(),
            backends: vec![
                sol_h3_backend("http://100.64.52.42:30010".into(), None),
                gb10_backend(),
            ],
        }
    }
}

#[derive(Serialize, Deserialize)]
struct ConfigFile {
    schema_version: u32,
    #[serde(flatten)]
    settings: Settings,
}

pub fn load_config(dir: &Path) -> AppResult<Settings> {
    let path = dir.join("config.json");
    if !path.exists() {
        let s = Settings::default();
        save_config(dir, &s)?;
        return Ok(s);
    }
    let raw = std::fs::read(&path).map_err(|e| AppError::Io(format!("read config.json: {e}")))?;
    match serde_json::from_slice::<ConfigFile>(&raw) {
        Ok(c) => {
            let mut settings = c.settings;
            settings.migrate_backends();
            Ok(settings)
        }
        Err(e) => {
            // 损坏则备份后用默认值
            let backup = dir.join("config.json.corrupt");
            let _ = std::fs::rename(&path, backup);
            tracing_warn(format!("config.json parse failed: {e}; using defaults"));
            let s = Settings::default();
            save_config(dir, &s)?;
            Ok(s)
        }
    }
}

pub fn save_config(dir: &Path, settings: &Settings) -> AppResult<()> {
    let file = ConfigFile {
        schema_version: 1,
        settings: settings.clone(),
    };
    let data = serde_json::to_vec_pretty(&file).map_err(|e| AppError::Io(e.to_string()))?;
    atomic_write(&dir.join("config.json"), &data).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

impl Settings {
    fn migrate_backends(&mut self) {
        if self.backends.is_empty() {
            self.backends
                .push(sol_h3_backend(self.base_url.clone(), self.api_key.clone()));
            self.backends.push(gb10_backend());
        }
        if let Some(backend) = self.backends.iter_mut().find(|b| b.id == "gb10") {
            let defaults = gb10_backend();
            if backend.base_url.trim().is_empty() {
                backend.base_url = defaults.base_url;
            }
            if backend
                .ssh_target
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
                || backend.ssh_target.as_deref() == Some("spark")
            {
                backend.ssh_target = defaults.ssh_target;
            }
            if backend
                .start_command
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
            {
                backend.start_command = defaults.start_command;
            }
            if backend
                .stop_command
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty()
            {
                backend.stop_command = defaults.stop_command;
            }
        }
        if !self.backends.iter().any(|b| b.id == self.active_backend_id) {
            self.active_backend_id = self.backends[0].id.clone();
        }
    }

    pub fn validate(&self) -> AppResult<()> {
        let check = |url: &str, name: &str| -> AppResult<()> {
            let u = reqwest::Url::parse(url)
                .map_err(|_| AppError::Config(format!("{name} 无法解析: {url}")))?;
            if u.scheme() != "http" && u.scheme() != "https" {
                return Err(AppError::Config(format!("{name} 必须是 http(s) 地址")));
            }
            Ok(())
        };
        check(&self.base_url, "base_url")?;
        if self.backends.is_empty() {
            return Err(AppError::Config("至少需要一个后端配置".into()));
        }
        for backend in &self.backends {
            if backend.id.trim().is_empty() || backend.label.trim().is_empty() {
                return Err(AppError::Config("后端 id 和名称不能为空".into()));
            }
            if !backend.base_url.trim().is_empty() {
                check(&backend.base_url, &format!("{} base_url", backend.label))?;
            }
        }
        if !self.backends.iter().any(|b| b.id == self.active_backend_id) {
            return Err(AppError::Config("当前后端不存在".into()));
        }
        if let Some(r) = &self.ref2va_base_url {
            check(r, "ref2va_base_url")?;
        }
        Ok(())
    }

    /// 去掉尾斜杠，供拼接路径用。
    pub fn base(&self) -> &str {
        self.active_backend()
            .map(|b| b.base_url.trim_end_matches('/'))
            .unwrap_or_else(|| self.base_url.trim_end_matches('/'))
    }

    pub fn active_backend(&self) -> Option<&BackendConfig> {
        self.backends
            .iter()
            .find(|b| b.id == self.active_backend_id)
    }

    pub fn backend(&self, id: &str) -> Option<&BackendConfig> {
        self.backends.iter().find(|b| b.id == id)
    }

    pub fn active_key(&self) -> Option<String> {
        self.active_backend()
            .and_then(|b| b.api_key.clone())
            .or_else(|| self.api_key.clone())
    }

    pub fn key_for_backend(&self, id: &str) -> Option<String> {
        if id == "ref2va" {
            return self.ref2va_key();
        }
        self.backend(id)
            .and_then(|b| b.api_key.clone())
            .or_else(|| self.api_key.clone())
    }

    /// Ref2VA 服务 base；未配置返回 None。
    pub fn ref2va_base(&self) -> Option<&str> {
        self.ref2va_base_url
            .as_deref()
            .map(|s| s.trim_end_matches('/'))
            .filter(|s| !s.is_empty())
    }

    /// Ref2VA 鉴权 key：优先专用 key，否则沿用主服务 key。
    pub fn ref2va_key(&self) -> Option<String> {
        self.ref2va_api_key
            .clone()
            .filter(|k| !k.is_empty())
            .or_else(|| self.api_key.clone())
    }
}

// 极简日志（避免引入 tracing 全家桶）
pub fn tracing_warn(msg: String) {
    eprintln!("[h3-workbench][warn] {msg}");
}
