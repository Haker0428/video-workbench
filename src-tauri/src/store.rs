use std::path::{Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::util::atomic_write;

/// Ref2VA 图片参考（含客户端语义标签）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefImage {
    pub id: String,
    /// 人物 / 场景 / 风格（仅客户端记录，不随请求发送）。
    #[serde(default)]
    pub tag: String,
    /// 相对 app_data_dir 的路径。
    pub file: String,
}

/// 任务请求参数快照（重试/再次生成的依据）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestParams {
    pub prompt: String,
    #[serde(default)]
    pub audio_desc: Option<String>,
    /// 实际发给服务的完整提示词（可能拼接了 overall_soundscape）。
    pub composed_prompt: String,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub duration_s: Option<f64>,
    #[serde(default)]
    pub steps: Option<u32>,
    #[serde(default)]
    pub first_frame_id: Option<String>,
    #[serde(default)]
    pub last_frame_id: Option<String>,
    /// 帧文件相对路径（前端预览/回填用）。
    #[serde(default)]
    pub first_frame_file: Option<String>,
    #[serde(default)]
    pub last_frame_file: Option<String>,
    /// Ref2VA：图片参考（有序）。
    #[serde(default)]
    pub ref_images: Vec<RefImage>,
    #[serde(default)]
    pub ref_video_id: Option<String>,
    #[serde(default)]
    pub ref_video_file: Option<String>,
    #[serde(default)]
    pub ref_audio_id: Option<String>,
    #[serde(default)]
    pub ref_audio_file: Option<String>,
}

/// 任务状态（与服务端一致）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Queued,
    Running,
    Completed,
    Failed,
}

impl TaskStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, TaskStatus::Completed | TaskStatus::Failed)
    }
}

/// 服务端返回的耗时与错误信息。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GenerationProgress {
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub current_step: Option<u32>,
    #[serde(default)]
    pub total_steps: Option<u32>,
    #[serde(default)]
    pub percent: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ServerInfo {
    #[serde(default)]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub e2e_s: Option<f64>,
    #[serde(default)]
    pub qwen_s: Option<f64>,
    #[serde(default)]
    pub stage1_s: Option<f64>,
    #[serde(default)]
    pub stage2_s: Option<f64>,
    #[serde(default)]
    pub progress: Option<GenerationProgress>,
    #[serde(default)]
    pub error: Option<String>,
}

/// 本地归档信息。相对路径相对 app_data_dir。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LocalInfo {
    #[serde(default)]
    pub video_file: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub bytes_total: Option<u64>,
    #[serde(default)]
    pub thumb_file: Option<String>,
}

/// 轮询/丢失标记。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PollInfo {
    #[serde(default)]
    pub last_polled_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub lost: bool,
    #[serde(default)]
    pub lost_reason: Option<String>,
}

/// 一条任务记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: String,
    pub created_at: DateTime<Utc>,
    /// Backend provenance keeps polling and downloads stable after switching engines.
    #[serde(default = "default_backend_id")]
    pub backend_id: String,
    #[serde(default)]
    pub backend_label: String,
    #[serde(default)]
    pub service_base_url: Option<String>,
    pub request: RequestParams,
    /// 服务端实际路由："t2va" | "fl2va"。
    pub routed_task: String,
    pub status: TaskStatus,
    #[serde(default)]
    pub server: ServerInfo,
    #[serde(default)]
    pub local: LocalInfo,
    #[serde(default)]
    pub poll: PollInfo,
}

fn default_backend_id() -> String {
    "sol_h3".into()
}

impl TaskRecord {
    pub fn video_rel(&self) -> String {
        format!("videos/{}.mp4", self.id)
    }
    pub fn thumb_rel(&self) -> String {
        format!("thumbs/{}.jpg", self.id)
    }
}

#[derive(Serialize, Deserialize)]
struct TaskFile {
    schema_version: u32,
    tasks: Vec<TaskRecord>,
    last_used_seed: Option<u64>,
}

/// 任务历史存储：内存 + tasks.json 原子持久化。
pub struct TaskStore {
    path: PathBuf,
    pub tasks: Vec<TaskRecord>,
    pub last_used_seed: Option<u64>,
}

impl TaskStore {
    pub fn load(dir: &Path) -> AppResult<Self> {
        let path = dir.join("tasks.json");
        if !path.exists() {
            return Ok(Self {
                path,
                tasks: Vec::new(),
                last_used_seed: None,
            });
        }
        let raw =
            std::fs::read(&path).map_err(|e| AppError::Io(format!("read tasks.json: {e}")))?;
        let file: TaskFile = match serde_json::from_slice(&raw) {
            Ok(f) => f,
            Err(e) => {
                let ts = Utc::now().format("%Y%m%d-%H%M%S");
                let _ = std::fs::rename(&path, dir.join(format!("tasks.json.corrupt-{ts}")));
                crate::config::tracing_warn(format!(
                    "tasks.json parse failed: {e}; starting empty"
                ));
                return Ok(Self {
                    path,
                    tasks: Vec::new(),
                    last_used_seed: None,
                });
            }
        };
        let mut tasks = file.tasks;
        tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(Self {
            path,
            tasks,
            last_used_seed: file.last_used_seed,
        })
    }

    pub fn save(&self) -> AppResult<()> {
        let file = TaskFile {
            schema_version: 1,
            tasks: self.tasks.clone(),
            last_used_seed: self.last_used_seed,
        };
        let data = serde_json::to_vec_pretty(&file).map_err(|e| AppError::Io(e.to_string()))?;
        atomic_write(&self.path, &data).map_err(|e| AppError::Io(e.to_string()))?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&TaskRecord> {
        self.tasks.iter().find(|t| t.id == id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut TaskRecord> {
        self.tasks.iter_mut().find(|t| t.id == id)
    }

    /// 插入新记录（保持 created_at 倒序）。
    pub fn insert(&mut self, record: TaskRecord) {
        let pos = self
            .tasks
            .iter()
            .position(|t| t.created_at < record.created_at)
            .unwrap_or(self.tasks.len());
        self.tasks.insert(pos, record);
    }

    pub fn remove(&mut self, id: &str) -> Option<TaskRecord> {
        let pos = self.tasks.iter().position(|t| t.id == id)?;
        Some(self.tasks.remove(pos))
    }

    pub fn set_last_used_seed(&mut self, seed: u64) {
        self.last_used_seed = Some(seed);
    }
}

/// RFC3339 时间戳（UTC，微秒精度）。
pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}
