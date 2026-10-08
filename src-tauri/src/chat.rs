//! 对话生成模式的会话持久化（chats.json）。
//!
//! 消息里的生成任务只存 task_id，任务详情仍以 tasks.json 为准。

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::util::atomic_write;

/// 附件（引用内容寻址素材，不存字节）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatAttachment {
    pub asset_id: String,
    pub file: String,
    /// image | video | audio
    pub kind: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    /// user | assistant
    pub role: String,
    #[serde(default)]
    pub text: Option<String>,
    /// 该消息生成任务使用的模式（t2va/fl2va/ref2va），自动判定结果或用户指定。
    #[serde(default)]
    pub mode: Option<String>,
    /// "auto" | 显式模式（仅 user 消息记录，展示用）。
    #[serde(default)]
    pub mode_selection: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub attachments: Vec<ChatAttachment>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub messages: Vec<ChatMessage>,
}

#[derive(Serialize, Deserialize)]
struct ChatFile {
    schema_version: u32,
    sessions: Vec<ChatSession>,
}

pub struct ChatStore {
    path: PathBuf,
    pub sessions: Vec<ChatSession>,
}

impl ChatStore {
    pub fn load(dir: &Path) -> AppResult<Self> {
        let path = dir.join("chats.json");
        if !path.exists() {
            return Ok(Self {
                path,
                sessions: Vec::new(),
            });
        }
        let raw =
            std::fs::read(&path).map_err(|e| AppError::Io(format!("read chats.json: {e}")))?;
        let file: ChatFile = match serde_json::from_slice(&raw) {
            Ok(f) => f,
            Err(e) => {
                let ts = Utc::now().format("%Y%m%d-%H%M%S");
                let _ = std::fs::rename(&path, dir.join(format!("chats.json.corrupt-{ts}")));
                crate::config::tracing_warn(format!(
                    "chats.json parse failed: {e}; starting empty"
                ));
                return Ok(Self {
                    path,
                    sessions: Vec::new(),
                });
            }
        };
        let mut sessions = file.sessions;
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(Self { path, sessions })
    }

    pub fn save(&self) -> AppResult<()> {
        let file = ChatFile {
            schema_version: 1,
            sessions: self.sessions.clone(),
        };
        let data = serde_json::to_vec_pretty(&file).map_err(|e| AppError::Io(e.to_string()))?;
        atomic_write(&self.path, &data).map_err(|e| AppError::Io(e.to_string()))?;
        Ok(())
    }

    /// 新增或整体更新一个会话（按 updated_at 倒序维护）。
    pub fn upsert(&mut self, session: ChatSession) -> AppResult<()> {
        let pos = self.sessions.iter().position(|s| s.id == session.id);
        match pos {
            Some(i) => self.sessions[i] = session,
            None => self.sessions.insert(0, session),
        }
        self.sessions
            .sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        self.save()
    }

    pub fn remove(&mut self, id: &str) -> AppResult<()> {
        self.sessions.retain(|s| s.id != id);
        self.save()
    }
}
