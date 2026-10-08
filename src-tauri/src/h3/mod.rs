pub mod types;

use std::time::Duration;

use serde_json::Value;

use crate::error::{AppError, AppResult};
use types::{DraftResp, HealthSnapshot, SubmitResp, TaskView, UploadResp};

/// 解析错误响应体 {"error": "..."}；解析不出就用状态码描述。
pub fn parse_error_body(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
        .unwrap_or_else(|| body.trim().to_string());
    if message.is_empty() {
        format!("HTTP {status}")
    } else {
        message
    }
}

/// Sol-H3-Spark HTTP 客户端（reqwest 直连，不走 tauri-plugin-http）。
#[derive(Clone)]
pub struct H3Client {
    http: reqwest::Client,
}

impl Default for H3Client {
    fn default() -> Self {
        Self::new()
    }
}

impl H3Client {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            // Tailscale and LAN inference endpoints must bypass macOS HTTP proxies.
            .no_proxy()
            .build()
            .expect("failed to build reqwest client");
        Self { http }
    }

    fn auth(&self, key: &Option<String>, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match key {
            Some(k) if !k.is_empty() => req.bearer_auth(k),
            _ => req,
        }
    }

    /// 解析错误响应体 {"error": "..."}；解析不出就用状态码描述。
    async fn error_from_resp(status: u16, body: &str) -> AppError {
        AppError::Api {
            status,
            message: parse_error_body(status, body),
        }
    }

    /// GET /health（免鉴权）。200 与 503 都会解析出快照（503 时 status=error）。
    pub async fn health(&self, base: &str) -> AppResult<HealthSnapshot> {
        let resp = self
            .http
            .get(format!("{base}/health"))
            .timeout(Duration::from_secs(5))
            .send()
            .await?;
        let status = resp.status().as_u16();
        let body = resp.text().await?;
        if status == 200 || status == 503 {
            let snap: HealthSnapshot = serde_json::from_str(&body).map_err(|e| AppError::Api {
                status,
                message: format!("health body parse failed: {e}"),
            })?;
            Ok(snap)
        } else {
            Err(Self::error_from_resp(status, &body).await)
        }
    }

    /// POST /v1/videos。body 为已组装好的 JSON。
    pub async fn submit(
        &self,
        base: &str,
        key: &Option<String>,
        body: Value,
    ) -> AppResult<SubmitResp> {
        let resp = self
            .auth(key, self.http.post(format!("{base}/v1/videos")).json(&body))
            .timeout(Duration::from_secs(60))
            .send()
            .await?;
        let status = resp.status().as_u16();
        let text = resp.text().await?;
        if status == 202 {
            serde_json::from_str(&text).map_err(|e| AppError::Api {
                status: 202,
                message: format!("submit body parse failed: {e}"),
            })
        } else {
            Err(Self::error_from_resp(status, &text).await)
        }
    }

    /// 创建带附件任务的草稿目录。
    pub async fn create_draft(&self, base: &str, key: &Option<String>) -> AppResult<DraftResp> {
        let resp = self
            .auth(key, self.http.post(format!("{base}/v1/tasks")))
            .timeout(Duration::from_secs(15))
            .send()
            .await?;
        let status = resp.status().as_u16();
        let text = resp.text().await?;
        if status == 201 {
            serde_json::from_str(&text).map_err(|e| AppError::Api {
                status,
                message: format!("draft body parse failed: {e}"),
            })
        } else {
            Err(Self::error_from_resp(status, &text).await)
        }
    }

    /// 二进制 multipart 上传，避免把图片放大为 Base64 JSON。
    pub async fn upload_file(
        &self,
        base: &str,
        key: &Option<String>,
        task_id: &str,
        path: &std::path::Path,
        kind: &str,
        mime: &str,
    ) -> AppResult<UploadResp> {
        let bytes = tokio::fs::read(path).await?;
        let filename = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "upload.bin".into());
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(filename)
            .mime_str(mime)
            .map_err(|e| AppError::Invalid(format!("素材 MIME 非法: {e}")))?;
        let form = reqwest::multipart::Form::new()
            .text("type", kind.to_string())
            .part("file", part);
        let resp = self
            .auth(
                key,
                self.http
                    .post(format!("{base}/v1/tasks/{task_id}/files"))
                    .multipart(form),
            )
            // Large reference assets can be very slow over a relayed Tailscale path.
            .timeout(Duration::from_secs(30 * 60))
            .send()
            .await?;
        let status = resp.status().as_u16();
        let text = resp.text().await?;
        if status == 201 {
            serde_json::from_str(&text).map_err(|e| AppError::Api {
                status,
                message: format!("upload body parse failed: {e}"),
            })
        } else {
            Err(Self::error_from_resp(status, &text).await)
        }
    }

    /// 用已上传的文件 ID 提交草稿。
    pub async fn submit_draft(
        &self,
        base: &str,
        key: &Option<String>,
        task_id: &str,
        body: Value,
    ) -> AppResult<SubmitResp> {
        let resp = self
            .auth(
                key,
                self.http
                    .post(format!("{base}/v1/tasks/{task_id}/submit"))
                    .json(&body),
            )
            .timeout(Duration::from_secs(60))
            .send()
            .await?;
        let status = resp.status().as_u16();
        let text = resp.text().await?;
        if status == 202 {
            serde_json::from_str(&text).map_err(|e| AppError::Api {
                status,
                message: format!("submit draft body parse failed: {e}"),
            })
        } else {
            Err(Self::error_from_resp(status, &text).await)
        }
    }

    /// 尽力清理未提交完成的草稿；原始错误不应被清理错误覆盖。
    pub async fn cancel_draft(&self, base: &str, key: &Option<String>, task_id: &str) {
        let _ = self
            .auth(
                key,
                self.http.post(format!("{base}/v1/videos/{task_id}/cancel")),
            )
            .timeout(Duration::from_secs(10))
            .send()
            .await;
    }

    /// GET /v1/videos/{id}。
    pub async fn query(&self, base: &str, key: &Option<String>, id: &str) -> AppResult<TaskView> {
        let resp = self
            .auth(key, self.http.get(format!("{base}/v1/videos/{id}")))
            .timeout(Duration::from_secs(10))
            .send()
            .await?;
        let status = resp.status().as_u16();
        let text = resp.text().await?;
        if status == 200 {
            serde_json::from_str(&text).map_err(|e| AppError::Api {
                status,
                message: format!("query body parse failed: {e}"),
            })
        } else {
            Err(Self::error_from_resp(status, &text).await)
        }
    }

    /// GET /v1/videos/{id}/content，返回可流式读取的响应（调用方自行处理状态码）。
    pub async fn download(
        &self,
        base: &str,
        key: &Option<String>,
        id: &str,
        range: Option<String>,
    ) -> AppResult<reqwest::Response> {
        let mut req = self
            .auth(key, self.http.get(format!("{base}/v1/videos/{id}/content")))
            .timeout(Duration::from_secs(30))
            .header(reqwest::header::ACCEPT, "video/mp4");
        if let Some(r) = range {
            req = req.header(reqwest::header::RANGE, r);
        }
        let resp = req.send().await?;
        Ok(resp)
    }
}
