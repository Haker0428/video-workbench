use std::collections::HashSet;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use crate::AppState;

/// 归档进度事件 payload（h3://archive-progress）。
#[derive(Debug, Clone, Serialize)]
pub struct ArchiveProgress {
    pub id: String,
    /// downloading | done | failed
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub const ARCHIVE_EVENT: &str = "h3://archive-progress";

fn emit_progress(app: &AppHandle, payload: ArchiveProgress) {
    let _ = app.emit(ARCHIVE_EVENT, payload);
}

/// 归档下载管理：按 task_id 去重，.part 临时文件 + rename 落地。
#[derive(Default)]
pub struct Archiver {
    inflight: std::sync::Mutex<HashSet<String>>,
}

impl Archiver {
    /// 入队一个归档任务。已在下载中返回 false。
    pub fn enqueue(self: &Arc<Self>, app: AppHandle, id: String) -> bool {
        {
            let mut set = self.inflight.lock().unwrap();
            if set.contains(&id) {
                return false;
            }
            set.insert(id.clone());
        }
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let error = this.run(&app, &id).await;
            this.inflight.lock().unwrap().remove(&id);
            match error {
                None => {
                    emit_progress(
                        &app,
                        ArchiveProgress {
                            id,
                            state: "done".into(),
                            received: None,
                            total: None,
                            error: None,
                        },
                    );
                }
                Some(e) => {
                    crate::config::tracing_warn(format!("archive {id} failed: {e}"));
                    emit_progress(
                        &app,
                        ArchiveProgress {
                            id,
                            state: "failed".into(),
                            received: None,
                            total: None,
                            error: Some(e),
                        },
                    );
                }
            }
        });
        true
    }

    /// 执行下载。返回 None 表示成功，Some(原因) 表示失败。
    async fn run(&self, app: &AppHandle, id: &str) -> Option<String> {
        let state = app.state::<AppState>();
        let (base, key, video_path) = {
            let config = state.config.lock().unwrap();
            let store = state.store.lock().unwrap();
            match store.get(id) {
                Some(rec) => (
                    rec.service_base_url
                        .clone()
                        .unwrap_or_else(|| config.base().to_string()),
                    config.key_for_backend(&rec.backend_id),
                    state.data_dir.join(rec.video_rel()),
                ),
                None => return Some("task record not found".into()),
            }
        };

        let resp = match state
            .client
            .download(&base, &key, id, Some("bytes=0-".into()))
            .await
        {
            Ok(r) => r,
            Err(e) => return Some(e.to_string()),
        };
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            let message = crate::h3::parse_error_body(status, &body);
            return Some(format!("h3 api {status}: {message}"));
        }

        let total = resp.content_length();
        let part_path = video_path.with_extension("mp4.part");
        let mut file = match tokio::fs::File::create(&part_path).await {
            Ok(f) => f,
            Err(e) => return Some(format!("create part file: {e}")),
        };

        let mut received: u64 = 0;
        let mut last_emitted: u64 = 0;
        let mut stream = resp.bytes_stream();
        use futures::StreamExt;
        loop {
            match stream.next().await {
                Some(Ok(chunk)) => {
                    if let Err(e) = file.write_all(&chunk).await {
                        let _ = tokio::fs::remove_file(&part_path).await;
                        return Some(format!("write chunk: {e}"));
                    }
                    received += chunk.len() as u64;
                    // 节流：每 256KB 发一次进度
                    if received - last_emitted >= 256 * 1024 {
                        last_emitted = received;
                        emit_progress(
                            app,
                            ArchiveProgress {
                                id: id.to_string(),
                                state: "downloading".into(),
                                received: Some(received),
                                total,
                                error: None,
                            },
                        );
                    }
                }
                Some(Err(e)) => {
                    let _ = tokio::fs::remove_file(&part_path).await;
                    return Some(format!("download stream: {e}"));
                }
                None => break,
            }
        }
        if let Err(e) = file.flush().await {
            let _ = tokio::fs::remove_file(&part_path).await;
            return Some(format!("flush: {e}"));
        }
        drop(file);
        if let Err(e) = tokio::fs::rename(&part_path, &video_path).await {
            return Some(format!("finalize rename: {e}"));
        }

        // 更新记录并落盘（此段无 await，可安全持有 std Mutex）
        {
            let mut store = state.store.lock().unwrap();
            if let Some(rec) = store.get_mut(id) {
                rec.local.archived = true;
                rec.local.video_file = Some(rec.video_rel());
                rec.local.bytes_total = Some(received);
            }
            if let Err(e) = store.save() {
                return Some(format!("save store: {e}"));
            }
        }
        None
    }
}
