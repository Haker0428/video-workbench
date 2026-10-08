use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine as _;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::Digest as _;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::archiver::Archiver;
use crate::error::{AppError, AppResult};
use crate::h3::types::TaskView;
use crate::store::{
    now_iso, LocalInfo, PollInfo, RequestParams, ServerInfo, TaskRecord, TaskStatus,
};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct SubmitParams {
    pub prompt: String,
    #[serde(default)]
    pub audio_desc: Option<String>,
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
    /// Ref2VA：图片参考（有序，含语义标签）。
    #[serde(default)]
    pub ref_images: Vec<SubmitRefImage>,
    #[serde(default)]
    pub ref_video_id: Option<String>,
    #[serde(default)]
    pub ref_audio_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitRefImage {
    pub id: String,
    #[serde(default)]
    pub tag: String,
}

#[derive(Debug, Serialize)]
pub struct PollItem {
    pub id: String,
    /// 有变更时携带合并后的完整记录；无变更为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<TaskRecord>,
    /// 网络不可达（不改本地记录状态）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline: Option<String>,
    /// 查询单任务出错（401/404/410/503 等，不改本地状态，除 404/410 的 lost 标记外）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SubmitProgress {
    pub phase: String,
    pub percent: u8,
    pub detail: String,
}

fn emit_submit_progress(app: &AppHandle, phase: &str, percent: u8, detail: impl Into<String>) {
    let _ = app.emit(
        "submit-progress",
        SubmitProgress {
            phase: phase.into(),
            percent,
            detail: detail.into(),
        },
    );
}

#[tauri::command]
pub fn list_tasks(state: State<'_, AppState>) -> Vec<TaskRecord> {
    state.store.lock().unwrap().tasks.clone()
}

#[tauri::command]
pub async fn submit_task(
    state: State<'_, AppState>,
    app: AppHandle,
    params: SubmitParams,
) -> AppResult<TaskRecord> {
    if params.prompt.trim().is_empty() {
        return Err(AppError::Invalid("prompt 不能为空".into()));
    }
    match (params.width, params.height) {
        (Some(width), Some(height))
            if width > 0
                && height > 0
                && width % 32 == 0
                && height % 32 == 0
                && u64::from(width) * u64::from(height) <= 1_032_192 => {}
        (None, None) => {}
        _ => {
            return Err(AppError::Invalid(
                "宽高必须同时提供、为 32 的倍数，且总像素不超过 1032192".into(),
            ))
        }
    }
    if params
        .duration_s
        .is_some_and(|value| !(5.0..=14.375).contains(&value))
    {
        return Err(AppError::Invalid("时长必须在 5 到 14.375 秒之间".into()));
    }
    if params
        .steps
        .is_some_and(|value| !(1..=100).contains(&value))
    {
        return Err(AppError::Invalid("步数必须在 1 到 100 之间".into()));
    }
    let audio = params
        .audio_desc
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let composed_prompt = match audio {
        Some(a) => format!("{} overall_soundscape: {}", params.prompt.trim(), a),
        None => params.prompt.trim().to_string(),
    };

    let is_ref = !params.ref_images.is_empty()
        || params.ref_video_id.is_some()
        || params.ref_audio_id.is_some();
    if is_ref && (params.first_frame_id.is_some() || params.last_frame_id.is_some()) {
        return Err(AppError::Invalid("参考字段与首尾帧字段不能混用".into()));
    }

    // 组装请求体；Ref2VA 走独立服务地址
    let (base, key, backend_id, backend_label) = {
        let config = state.config.lock().unwrap();
        if is_ref {
            (
                config
                    .ref2va_base()
                    .ok_or_else(|| {
                        AppError::Invalid("Ref2VA 服务未配置，请在设置中填写服务地址".into())
                    })?
                    .to_string(),
                config.ref2va_key(),
                "ref2va".to_string(),
                "Sol-H3 Ref2VA".to_string(),
            )
        } else {
            let backend = config
                .active_backend()
                .ok_or_else(|| AppError::Config("当前后端不存在".into()))?;
            if backend.base_url.trim().is_empty() {
                return Err(AppError::Config(format!(
                    "{} 尚未配置 API 地址",
                    backend.label
                )));
            }
            (
                backend.base_url.trim_end_matches('/').to_string(),
                config.active_key(),
                backend.id.clone(),
                backend.label.clone(),
            )
        }
    };

    let mut body = serde_json::Map::new();
    body.insert(
        "prompt".into(),
        serde_json::Value::String(composed_prompt.clone()),
    );
    if let Some(seed) = params.seed {
        body.insert("seed".into(), serde_json::Value::from(seed));
    }
    for (key, value) in [
        ("width", params.width.map(serde_json::Value::from)),
        ("height", params.height.map(serde_json::Value::from)),
        ("duration_s", params.duration_s.map(serde_json::Value::from)),
        ("steps", params.steps.map(serde_json::Value::from)),
    ] {
        if let Some(value) = value {
            body.insert(key.into(), value);
        }
    }

    let mut first_frame_file: Option<String> = None;
    let mut last_frame_file: Option<String> = None;
    let mut ref_image_rows: Vec<crate::store::RefImage> = Vec::new();
    let mut ref_video_file: Option<String> = None;
    let mut ref_audio_file: Option<String> = None;

    let upload_count = params.ref_images.len()
        + usize::from(params.ref_video_id.is_some())
        + usize::from(params.ref_audio_id.is_some())
        + usize::from(params.first_frame_id.is_some())
        + usize::from(params.last_frame_id.is_some());

    let resp_result = if upload_count == 0 {
        emit_submit_progress(&app, "submitting", 60, "正在提交文生任务");
        state
            .client
            .submit(&base, &key, serde_json::Value::Object(body.clone()))
            .await
    } else {
        emit_submit_progress(&app, "creating", 5, "正在创建远端任务目录");
        let draft = state.client.create_draft(&base, &key).await?;
        let task_id = draft.id.clone();
        let result: AppResult<crate::h3::types::SubmitResp> = async {
            let mut uploaded = 0usize;
            let mut references = Vec::new();

            for r in &params.ref_images {
                emit_submit_progress(
                    &app,
                    "uploading",
                    10 + (uploaded * 70 / upload_count) as u8,
                    format!("正在上传图片参考 {}/{}", uploaded + 1, upload_count),
                );
                let (path, rel, mime) = find_asset_file(&state.data_dir, "frames", &r.id)?;
                let item = state
                    .client
                    .upload_file(&base, &key, &task_id, &path, "image", &mime)
                    .await?;
                references.push(serde_json::json!({"type": "image", "file_id": item.id}));
                ref_image_rows.push(crate::store::RefImage {
                    id: r.id.clone(),
                    tag: r.tag.clone(),
                    file: rel,
                });
                uploaded += 1;
            }

            if let Some(vid) = params.ref_video_id.as_deref() {
                emit_submit_progress(
                    &app,
                    "uploading",
                    10 + (uploaded * 70 / upload_count) as u8,
                    "正在上传视频参考",
                );
                let (path, rel, mime) = find_asset_file(&state.data_dir, "refs", vid)?;
                let item = state
                    .client
                    .upload_file(&base, &key, &task_id, &path, "video", &mime)
                    .await?;
                references.push(serde_json::json!({"type": "video", "file_id": item.id}));
                ref_video_file = Some(rel);
                uploaded += 1;
            }

            if let Some(aid) = params.ref_audio_id.as_deref() {
                emit_submit_progress(
                    &app,
                    "uploading",
                    10 + (uploaded * 70 / upload_count) as u8,
                    "正在上传音频参考",
                );
                let (path, rel, mime) = find_asset_file(&state.data_dir, "refs", aid)?;
                let item = state
                    .client
                    .upload_file(&base, &key, &task_id, &path, "audio", &mime)
                    .await?;
                references.push(serde_json::json!({"type": "audio", "file_id": item.id}));
                ref_audio_file = Some(rel);
                uploaded += 1;
            }

            for (slot, frame_id, file_slot, label) in [
                (
                    "first_frame",
                    params.first_frame_id.as_deref(),
                    &mut first_frame_file,
                    "首帧",
                ),
                (
                    "last_frame",
                    params.last_frame_id.as_deref(),
                    &mut last_frame_file,
                    "尾帧",
                ),
            ] {
                if let Some(fid) = frame_id {
                    emit_submit_progress(
                        &app,
                        "uploading",
                        10 + (uploaded * 70 / upload_count) as u8,
                        format!("正在上传{label}"),
                    );
                    let (path, rel, mime) = find_asset_file(&state.data_dir, "frames", fid)?;
                    let item = state
                        .client
                        .upload_file(&base, &key, &task_id, &path, "image", &mime)
                        .await?;
                    body.insert(
                        format!("{slot}_file_id"),
                        serde_json::Value::String(item.id),
                    );
                    *file_slot = Some(rel);
                    uploaded += 1;
                }
            }

            if is_ref {
                body.insert("references".into(), serde_json::Value::Array(references));
            }
            emit_submit_progress(&app, "queueing", 90, "素材上传完成，正在加入生成队列");
            state
                .client
                .submit_draft(
                    &base,
                    &key,
                    &task_id,
                    serde_json::Value::Object(body.clone()),
                )
                .await
        }
        .await;
        if result.is_err() {
            state.client.cancel_draft(&base, &key, &task_id).await;
        }
        result
    };

    let resp = match resp_result {
        Ok(resp) => resp,
        Err(error) => {
            emit_submit_progress(&app, "failed", 100, "提交失败");
            return Err(error);
        }
    };
    emit_submit_progress(&app, "queued", 100, "任务已加入队列");

    let record = TaskRecord {
        id: resp.id,
        created_at: parse_ts(&resp.created_at).unwrap_or_else(Utc::now),
        backend_id,
        backend_label,
        service_base_url: Some(base),
        request: RequestParams {
            prompt: params.prompt,
            audio_desc: audio.map(String::from),
            composed_prompt,
            seed: params.seed,
            width: params.width,
            height: params.height,
            duration_s: params.duration_s,
            steps: params.steps,
            first_frame_id: params.first_frame_id,
            last_frame_id: params.last_frame_id,
            first_frame_file,
            last_frame_file,
            ref_images: ref_image_rows,
            ref_video_id: params.ref_video_id,
            ref_video_file,
            ref_audio_id: params.ref_audio_id,
            ref_audio_file,
        },
        routed_task: resp.task,
        status: TaskStatus::Queued,
        server: ServerInfo::default(),
        local: LocalInfo::default(),
        poll: PollInfo {
            last_polled_at: Some(Utc::now()),
            ..Default::default()
        },
    };

    {
        let mut store = state.store.lock().unwrap();
        store.insert(record.clone());
        store.set_last_used_seed(resp.seed);
        store.save()?;
    }
    Ok(record)
}

/// 并发查询多个任务并合并进本地记录；completed 且开启自动归档时触发归档。
#[tauri::command]
pub async fn poll_tasks(
    state: State<'_, AppState>,
    app: AppHandle,
    ids: Vec<String>,
) -> AppResult<Vec<PollItem>> {
    let (requests, auto_archive) = {
        let config = state.config.lock().unwrap();
        let store = state.store.lock().unwrap();
        let requests = ids
            .iter()
            .map(|id| {
                let record = store.get(id);
                let backend_id = record
                    .map(|r| r.backend_id.as_str())
                    .unwrap_or(&config.active_backend_id);
                let base = record
                    .and_then(|r| r.service_base_url.clone())
                    .or_else(|| config.backend(backend_id).map(|b| b.base_url.clone()))
                    .unwrap_or_else(|| config.base().to_string());
                (
                    id.clone(),
                    base.trim_end_matches('/').to_string(),
                    config.key_for_backend(backend_id),
                )
            })
            .collect::<Vec<_>>();
        (requests, config.auto_archive)
    };

    // fan-out：并发查询（单请求 10s 超时互不拖累）
    let futures = requests.into_iter().map(|(id, base, key)| {
        let client = state.client.clone();
        async move { (id.clone(), client.query(&base, &key, &id).await) }
    });
    let results: Vec<(String, Result<TaskView, AppError>)> =
        futures::future::join_all(futures).await;

    let mut items = Vec::with_capacity(results.len());
    let mut any_mutation = false;
    let now = Utc::now();
    {
        let mut store = state.store.lock().unwrap();
        for (id, result) in results {
            match result {
                Ok(view) => {
                    let Some(rec) = store.get_mut(&id) else {
                        items.push(PollItem {
                            id,
                            record: None,
                            offline: None,
                            error: Some("本地记录不存在".into()),
                        });
                        continue;
                    };
                    rec.poll.last_polled_at = Some(now);
                    rec.poll.lost = false;
                    rec.poll.lost_reason = None;
                    apply_view(rec, &view);
                    let finished = rec.status == TaskStatus::Completed;
                    let need_archive = finished && !rec.local.archived;
                    let record = rec.clone();
                    items.push(PollItem {
                        id: id.clone(),
                        record: Some(record),
                        offline: None,
                        error: None,
                    });
                    any_mutation = true;
                    if need_archive && auto_archive {
                        let archiver: tauri::State<'_, Arc<Archiver>> =
                            app.state::<Arc<Archiver>>();
                        archiver.inner().enqueue(app.clone(), id);
                    }
                }
                Err(AppError::Api {
                    status: 404 | 410,
                    message,
                }) => {
                    let Some(rec) = store.get_mut(&id) else {
                        items.push(PollItem {
                            id,
                            record: None,
                            offline: None,
                            error: Some(message),
                        });
                        continue;
                    };
                    // 已归档的任务不受远端丢失影响；未归档标记 lost
                    if !rec.local.archived {
                        rec.poll.last_polled_at = Some(now);
                        rec.poll.lost = true;
                        rec.poll.lost_reason = Some(message);
                        any_mutation = true;
                        let record = rec.clone();
                        items.push(PollItem {
                            id,
                            record: Some(record),
                            offline: None,
                            error: None,
                        });
                    } else {
                        rec.poll.last_polled_at = Some(now);
                        items.push(PollItem {
                            id,
                            record: None,
                            offline: None,
                            error: None,
                        });
                    }
                }
                Err(AppError::Conn(m)) => {
                    items.push(PollItem {
                        id,
                        record: None,
                        offline: Some(m),
                        error: None,
                    });
                }
                Err(e) => {
                    items.push(PollItem {
                        id,
                        record: None,
                        offline: None,
                        error: Some(e.to_string()),
                    });
                }
            }
        }
        if any_mutation {
            if let Err(e) = store.save() {
                crate::config::tracing_warn(format!("poll_tasks save: {e}"));
            }
        }
    }
    Ok(items)
}

#[tauri::command]
pub fn delete_task(state: State<'_, AppState>, id: String, delete_files: bool) -> AppResult<()> {
    let removed = {
        let mut store = state.store.lock().unwrap();
        let rec = store.remove(&id);
        store.save()?;
        rec
    };
    if delete_files {
        if let Some(rec) = removed {
            let video = state.data_dir.join(rec.video_rel());
            let _ = std::fs::remove_file(video.with_extension("mp4.part"));
            let _ = std::fs::remove_file(&video);
            let _ = std::fs::remove_file(state.data_dir.join(rec.thumb_rel()));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_thumbnail(state: State<'_, AppState>, id: String, data_url: String) -> AppResult<()> {
    let bytes = decode_data_url(&data_url)
        .ok_or_else(|| AppError::Invalid("thumbnail data_url 无法解析".into()))?;
    let mut store = state.store.lock().unwrap();
    let Some(rec) = store.get_mut(&id) else {
        return Err(AppError::Invalid("任务不存在".into()));
    };
    let rel = rec.thumb_rel();
    std::fs::write(state.data_dir.join(&rel), bytes)?;
    rec.local.thumb_file = Some(rel);
    store.save()?;
    Ok(())
}

/// 手动归档。返回状态："started" | "in_progress" | "already_archived"。
#[tauri::command]
pub fn archive_task(state: State<'_, AppState>, app: AppHandle, id: String) -> AppResult<String> {
    let rec = {
        let store = state.store.lock().unwrap();
        store.get(&id).cloned()
    };
    let Some(rec) = rec else {
        return Err(AppError::Invalid("任务不存在".into()));
    };
    if rec.local.archived {
        return Ok("already_archived".into());
    }
    if rec.status != TaskStatus::Completed {
        return Err(AppError::Invalid("任务尚未完成，无法归档".into()));
    }
    let handle = app.clone();
    let archiver: tauri::State<'_, Arc<Archiver>> = app.state::<Arc<Archiver>>();
    Ok(if archiver.inner().enqueue(handle, id) {
        "started".to_string()
    } else {
        "in_progress".to_string()
    })
}

#[tauri::command]
pub fn reveal_task_files(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let rec = {
        let store = state.store.lock().unwrap();
        store.get(&id).cloned()
    };
    let Some(rec) = rec else {
        return Err(AppError::Invalid("任务不存在".into()));
    };
    if rec.local.archived {
        let video = state.data_dir.join(rec.video_rel());
        tauri_plugin_opener::reveal_item_in_dir(video).map_err(|e| AppError::Io(e.to_string()))?;
    } else {
        let dir = state.data_dir.join("videos");
        tauri_plugin_opener::open_path(dir, None::<&str>)
            .map_err(|e| AppError::Io(e.to_string()))?;
    }
    Ok(())
}

/// 导出归档副本到用户指定目录。
#[tauri::command]
pub fn export_task_video(
    state: State<'_, AppState>,
    id: String,
    dest: String,
) -> AppResult<String> {
    let rec = {
        let store = state.store.lock().unwrap();
        store.get(&id).cloned()
    };
    let Some(rec) = rec else {
        return Err(AppError::Invalid("任务不存在".into()));
    };
    let src = state.data_dir.join(rec.video_rel());
    if !src.is_file() {
        return Err(AppError::Invalid("本地没有已归档的视频文件".into()));
    }
    let dest_path = std::path::PathBuf::from(&dest).join(format!("{}.mp4", rec.id));
    std::fs::copy(&src, &dest_path)?;
    Ok(dest_path.to_string_lossy().into_owned())
}

// ---------- 内部工具 ----------

/// 在内容寻址素材目录（frames/ 或 refs/）按 id 前缀查找文件。
fn find_asset_file(
    data_dir: &std::path::Path,
    subdir: &str,
    asset_id: &str,
) -> AppResult<(std::path::PathBuf, String, String)> {
    // 防 path 拼接注入
    if asset_id.contains("..") || asset_id.contains('/') || asset_id.contains('\\') {
        return Err(AppError::Invalid("asset id 非法".into()));
    }
    let dir = data_dir.join(subdir);
    let entry = std::fs::read_dir(&dir)
        .map_err(|e| AppError::Io(format!("read {subdir} dir: {e}")))?
        .filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy().starts_with(asset_id));
    let path = entry
        .map(|e| e.path())
        .ok_or_else(|| AppError::Invalid(format!("素材文件不存在: {asset_id}")))?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let mime = crate::util::ext_to_mime(ext).to_string();
    let rel = format!(
        "{subdir}/{}",
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    Ok((path, rel, mime))
}

fn decode_data_url(data_url: &str) -> Option<Vec<u8>> {
    let rest = data_url.strip_prefix("data:")?;
    let (_, b64) = rest.split_once("base64,")?;
    base64::engine::general_purpose::STANDARD.decode(b64).ok()
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// 把服务端 TaskView 合并进本地记录。
fn apply_view(rec: &mut TaskRecord, view: &TaskView) {
    rec.status = match view.status.as_str() {
        "queued" => TaskStatus::Queued,
        "running" => TaskStatus::Running,
        "completed" => TaskStatus::Completed,
        "failed" => TaskStatus::Failed,
        _ => rec.status,
    };
    rec.routed_task = view.task.clone().unwrap_or_else(|| rec.routed_task.clone());
    let s = &mut rec.server;
    s.started_at = view.started_at.as_deref().and_then(parse_ts);
    s.completed_at = view.completed_at.as_deref().and_then(parse_ts);
    s.e2e_s = view.e2e_s;
    s.qwen_s = view.qwen_s;
    s.stage1_s = view.stage1_s;
    s.stage2_s = view.stage2_s;
    s.progress = view.progress.clone();
    s.error = view.error.clone();
    if let Some(seed) = view.seed {
        rec.request.seed = Some(seed);
    }
}

/// 帧文件保存后的返回。
#[derive(Debug, Serialize)]
pub struct FrameRef {
    pub frame_id: String,
    pub mime: String,
    pub size: u64,
    /// 相对 app_data_dir 的路径（前端经 h3video:// 预览）。
    pub file: String,
}

/// 保存上传的首帧/尾帧（raw body 经 IPC 传输），内容寻址去重。
#[tauri::command]
pub fn save_frame(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<FrameRef> {
    let bytes: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(raw) => raw.clone(),
        _ => return Err(AppError::Invalid("期望二进制请求体".into())),
    };
    if bytes.is_empty() || bytes.len() > 16 * 1024 * 1024 {
        return Err(AppError::Invalid("图片大小必须在 1B..16MiB 之间".into()));
    }
    let mime = crate::util::sniff_image_mime(&bytes)
        .ok_or_else(|| AppError::Invalid("仅支持 png/jpeg/webp 图片".into()))?;
    let digest = sha2::Sha256::digest(&bytes);
    let frame_id: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    let rel = format!("frames/{}.{}", frame_id, crate::util::mime_to_ext(mime));
    let path = state.data_dir.join(&rel);
    if !path.exists() {
        std::fs::write(&path, &bytes)?;
    }
    Ok(FrameRef {
        frame_id,
        mime: mime.into(),
        size: bytes.len() as u64,
        file: rel,
    })
}

/// 参考素材保存后的返回。
#[derive(Debug, Serialize)]
pub struct RefAssetRef {
    pub asset_id: String,
    pub mime: String,
    pub size: u64,
    pub file: String,
}

const REF_VIDEO_MAX: usize = 96 * 1024 * 1024;
const REF_AUDIO_MAX: usize = 16 * 1024 * 1024;

/// 保存 Ref2VA 视频参考（mp4/webm ≤96MiB）。
#[tauri::command]
pub fn save_ref_video(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<RefAssetRef> {
    save_ref_asset(state, request, "video")
}

/// 保存 Ref2VA 音频参考（wav/mp3/m4a/ogg/flac ≤16MiB）。
#[tauri::command]
pub fn save_ref_audio(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<RefAssetRef> {
    save_ref_asset(state, request, "audio")
}

fn save_ref_asset(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
    kind: &str,
) -> AppResult<RefAssetRef> {
    let bytes: Vec<u8> = match request.body() {
        tauri::ipc::InvokeBody::Raw(raw) => raw.clone(),
        _ => return Err(AppError::Invalid("期望二进制请求体".into())),
    };
    let max = if kind == "video" {
        REF_VIDEO_MAX
    } else {
        REF_AUDIO_MAX
    };
    let label = if kind == "video" { "视频" } else { "音频" };
    if bytes.is_empty() || bytes.len() > max {
        return Err(AppError::Invalid(format!(
            "{label}大小必须在 1B..{} 之间",
            fmt_mb(max)
        )));
    }
    let mime = crate::util::sniff_media_mime(&bytes).ok_or_else(|| {
        AppError::Invalid(if kind == "video" {
            "仅支持 mp4/webm 视频".into()
        } else {
            "仅支持 wav/mp3/m4a/ogg/flac 音频".into()
        })
    })?;
    let mime_ok = if kind == "video" {
        mime.starts_with("video/")
    } else {
        mime.starts_with("audio/")
    };
    if !mime_ok {
        return Err(AppError::Invalid(format!("文件不是{label}")));
    }
    let digest = sha2::Sha256::digest(&bytes);
    let asset_id: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    let rel = format!("refs/{}.{}", asset_id, crate::util::mime_to_ext(mime));
    let path = state.data_dir.join(&rel);
    if !path.exists() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &bytes)?;
    }
    Ok(RefAssetRef {
        asset_id,
        mime: mime.into(),
        size: bytes.len() as u64,
        file: rel,
    })
}

fn fmt_mb(bytes: usize) -> String {
    format!("{}MiB", bytes / (1024 * 1024))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端 SubmitParams（Ref2VA）→ Rust 反序列化 → 记录序列化，字段名锁定。
    #[test]
    fn ref2va_params_roundtrip() {
        let json = serde_json::json!({
            "prompt": "@人物 走过场景",
            "audio_desc": null,
            "seed": 42,
            "width": 576,
            "height": 1024,
            "duration_s": 8,
            "steps": 10,
            "first_frame_id": null,
            "last_frame_id": null,
            "ref_images": [{ "id": "abc123", "tag": "人物" }],
            "ref_video_id": null,
            "ref_audio_id": "def456"
        });
        let params: SubmitParams = serde_json::from_value(json).unwrap();
        assert_eq!(params.ref_images.len(), 1);
        assert_eq!(params.ref_images[0].tag, "人物");
        assert_eq!(params.ref_audio_id.as_deref(), Some("def456"));
        assert_eq!((params.width, params.height), (Some(576), Some(1024)));
        assert_eq!(params.duration_s, Some(8.0));
        assert_eq!(params.steps, Some(10));
        assert!(!params.ref_images.is_empty());

        // RequestParams 含 ref 字段的序列化形态（前端回填依赖）
        let record = TaskRecord {
            id: "x".into(),
            created_at: Utc::now(),
            backend_id: "sol_h3".into(),
            backend_label: "Sol-H3 Spark".into(),
            service_base_url: Some("http://100.64.52.42:30010".into()),
            request: RequestParams {
                prompt: "p".into(),
                audio_desc: None,
                composed_prompt: "p".into(),
                seed: Some(1),
                width: Some(576),
                height: Some(1024),
                duration_s: Some(8.0),
                steps: Some(10),
                first_frame_id: None,
                last_frame_id: None,
                first_frame_file: None,
                last_frame_file: None,
                ref_images: vec![crate::store::RefImage {
                    id: "abc123".into(),
                    tag: "人物".into(),
                    file: "frames/abc123.png".into(),
                }],
                ref_video_id: None,
                ref_video_file: None,
                ref_audio_id: Some("def456".into()),
                ref_audio_file: Some("refs/def456.wav".into()),
            },
            routed_task: "ref2va".into(),
            status: TaskStatus::Queued,
            server: ServerInfo::default(),
            local: LocalInfo::default(),
            poll: PollInfo::default(),
        };
        let out = serde_json::to_value(&record).unwrap();
        assert_eq!(out["request"]["ref_images"][0]["file"], "frames/abc123.png");
        assert_eq!(out["request"]["ref_audio_id"], "def456");
        assert_eq!(out["request"]["width"], 576);
        assert_eq!(out["request"]["duration_s"], 8.0);
        assert_eq!(out["request"]["steps"], 10);
    }
}

/// 静默导入：把已有归档（如迁移过来的目录）登记进历史（预留）。
#[tauri::command]
pub fn get_runtime_info(state: State<'_, AppState>) -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert(
        "data_dir".into(),
        state.data_dir.to_string_lossy().into_owned(),
    );
    m.insert("version".into(), env!("CARGO_PKG_VERSION").into());
    m.insert("now".into(), now_iso());
    m
}
