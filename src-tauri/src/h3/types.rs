use serde::{Deserialize, Serialize};

/// GET /health 响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSnapshot {
    pub status: String,
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub queue_depth: Option<i64>,
    #[serde(default)]
    pub active_task_id: Option<String>,
    #[serde(default)]
    pub startup: Option<StartupInfo>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupInfo {
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub percent: Option<i64>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub elapsed_s: Option<f64>,
    #[serde(default)]
    pub estimated_total_s: Option<f64>,
    #[serde(default)]
    pub estimated_remaining_s: Option<f64>,
}

/// POST /v1/videos 的 202 响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitResp {
    pub id: String,
    pub status: String,
    pub task: String,
    pub seed: u64,
    pub created_at: String,
}

/// POST /v1/tasks 的草稿响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftResp {
    pub id: String,
}

/// POST /v1/tasks/{id}/files 的上传响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResp {
    pub id: String,
}

/// GET /v1/videos/{id} 响应。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskView {
    pub id: String,
    pub status: String,
    pub task: Option<String>,
    pub seed: Option<u64>,
    pub created_at: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub e2e_s: Option<f64>,
    #[serde(default)]
    pub qwen_s: Option<f64>,
    #[serde(default)]
    pub stage1_s: Option<f64>,
    #[serde(default)]
    pub stage2_s: Option<f64>,
    #[serde(default)]
    pub progress: Option<crate::store::GenerationProgress>,
    #[serde(default)]
    pub output_url: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}
