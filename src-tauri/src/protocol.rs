//! h3video:// 自定义协议：前端播放视频/显示帧图/缩略图的统一入口。
//!
//! - 本地归档文件：Range/206 + 「过量供给」≥1MiB（对抗 WKWebView 碎片化 Range 请求）。
//! - 远端未归档视频（本地文件缺失）：reqwest 代理转发 Range，透传 206/Content-Range。
//!
//! 前端统一使用 `h3video://localhost/videos/<id>.mp4` 形态（macOS/Linux）；
//! Windows 为 `http://h3video.localhost/...`，由前端 lib/scheme.ts 负责分支。

use std::borrow::Cow;

use tauri::http::header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::util::{ext_to_mime, parse_range, read_range};
use crate::AppState;

/// 每次响应至少供给的字节数（对抗 webview 小碎块请求）。
const CHUNK: u64 = 1024 * 1024;
/// 无 Range 的 200 响应体上限；超过则主动降级为 206 首块，让 webview 续量请求。
const FULL_CAP: u64 = 64 * 1024 * 1024;
/// 远端代理单次读取上限。
const PROXY_CAP: u64 = 8 * 1024 * 1024;

pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("h3video", move |ctx, request, responder| {
        let app = ctx.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            let response = handle(app, request).await;
            responder.respond(response.map(Cow::Owned));
        });
    })
}

/// 路径分类。仅放行应用自管的三类目录，路径由这里做白名单校验。
enum Target {
    /// 本地文件（相对 app_data_dir）
    Local(std::path::PathBuf, &'static str),
    /// 远端视频代理（task id）
    RemoteVideo(String),
}

fn classify(path: &str) -> Option<Target> {
    let path = path.trim_start_matches('/');
    let mut segs = path.split('/');
    match (segs.next(), segs.next(), segs.next()) {
        (Some("videos"), Some(file), None) => {
            // videos/<id>.mp4
            let id = file.strip_suffix(".mp4")?;
            if !id.bytes().all(|b| b.is_ascii_hexdigit()) || id.len() != 32 {
                return None;
            }
            // 本地归档存在则走本地，否则代理远端
            Some(Target::RemoteVideo(id.to_string()))
        }
        (Some(dir @ ("frames" | "thumbs" | "refs")), Some(file), None) => {
            // 白名单文件名：hex 前缀 + 已知后缀
            let ext = file.rsplit('.').next()?;
            if !matches!(
                ext,
                "png"
                    | "jpg"
                    | "webp"
                    | "jpeg"
                    | "mp4"
                    | "webm"
                    | "wav"
                    | "mp3"
                    | "m4a"
                    | "ogg"
                    | "flac"
            ) {
                return None;
            }
            if file.contains("..") || file.contains('/') || file.contains('\\') {
                return None;
            }
            let mime = ext_to_mime(ext);
            Some(Target::Local(
                std::path::PathBuf::from(dir).join(file),
                mime,
            ))
        }
        _ => None,
    }
}

fn not_found(msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(CONTENT_TYPE, "application/json")
        .body(format!("{{\"error\":\"{msg}\"}}").into_bytes())
        .unwrap()
}

async fn handle<R: tauri::Runtime>(
    app: AppHandle<R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let path = request.uri().path().to_string();
    let range_header = request
        .headers()
        .get(RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    match classify(&path) {
        Some(Target::Local(rel, mime)) => {
            let full = app.state::<AppState>().data_dir.join(&rel);
            if !full.is_file() {
                return not_found("file not found");
            }
            match serve_local(&full, mime, range_header.as_deref()) {
                Ok(resp) => resp,
                Err(e) => not_found(&format!("read failed: {e}")),
            }
        }
        Some(Target::RemoteVideo(id)) => {
            let state = app.state::<AppState>();
            let full = state.data_dir.join("videos").join(format!("{id}.mp4"));
            if full.is_file() {
                return match serve_local(&full, "video/mp4", range_header.as_deref()) {
                    Ok(resp) => resp,
                    Err(e) => not_found(&format!("read failed: {e}")),
                };
            }
            proxy_remote(&state, &id, range_header.as_deref()).await
        }
        None => not_found("unsupported path"),
    }
}

/// 本地文件区间响应。Range 命中返回 206；无 Range 返回 200（超大文件降级为 206 首块）。
fn serve_local(
    path: &std::path::Path,
    mime: &str,
    range: Option<&str>,
) -> Result<Response<Vec<u8>>, String> {
    fn io(e: std::io::Error) -> String {
        e.to_string()
    }
    let len = std::fs::metadata(path).map_err(io)?.len();
    let builder = Response::builder()
        .header(CONTENT_TYPE, mime)
        .header(ACCEPT_RANGES, "bytes");

    match range.and_then(|h| parse_range(Some(h), len)) {
        Some((start, req_end)) => {
            // 过量供给：至少 CHUNK 字节（不超过文件尾）
            let end = req_end.max((start + CHUNK - 1).min(len - 1));
            let body = read_range(path, start, end).map_err(io)?;
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .header(CONTENT_LENGTH, body.len())
                .body(body)
                .map_err(|e| e.to_string())
        }
        None => {
            if len <= FULL_CAP {
                let body = std::fs::read(path).map_err(io)?;
                builder
                    .status(StatusCode::OK)
                    .header(CONTENT_LENGTH, body.len())
                    .body(body)
                    .map_err(|e| e.to_string())
            } else {
                // 主动降级为 206 首块，引导 webview 用 Range 续量
                let end = CHUNK.min(len) - 1;
                let body = read_range(path, 0, end).map_err(io)?;
                builder
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(CONTENT_RANGE, format!("bytes 0-{end}/{len}"))
                    .header(CONTENT_LENGTH, body.len())
                    .body(body)
                    .map_err(|e| e.to_string())
            }
        }
    }
}

/// 远端代理：转发 Range 头，截断到 PROXY_CAP 后修正 Content-Range（webview 会续量）。
async fn proxy_remote(
    state: &tauri::State<'_, AppState>,
    id: &str,
    range: Option<&str>,
) -> Response<Vec<u8>> {
    let (base, key) = {
        let config = state.config.lock().unwrap();
        let store = state.store.lock().unwrap();
        match store.get(id) {
            Some(record) => (
                record
                    .service_base_url
                    .clone()
                    .unwrap_or_else(|| config.base().to_string()),
                config.key_for_backend(&record.backend_id),
            ),
            None => (config.base().to_string(), config.active_key()),
        }
    };
    let resp = match state
        .client
        .download(&base, &key, id, range.map(str::to_string))
        .await
    {
        Ok(r) => r,
        Err(e) => return not_found(&e.to_string().replace('"', "'")),
    };

    let status = resp.status();
    if !status.is_success() {
        let code = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
        let body = match resp.text().await {
            Ok(t) => t,
            Err(_) => String::new(),
        };
        return Response::builder()
            .status(code)
            .header(CONTENT_TYPE, "application/json")
            .body(body.into_bytes())
            .unwrap();
    }

    let ct = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp4")
        .to_string();

    // 解析远端的 (total, served_start)
    let content_range = resp
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let content_length = resp.content_length();

    let (total, served_start) = match &content_range {
        Some(cr) => {
            // 形如 bytes 0-524287/1048576 或 bytes 0-524287/*
            let spec = cr.split(' ').nth(1).unwrap_or("");
            let (range_part, total_part) = spec.split_once('/').unwrap_or(("", "*"));
            let total = total_part.parse::<u64>().ok();
            let start = range_part
                .split('-')
                .next()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            (total, start)
        }
        None => (content_length, 0),
    };

    // 读取响应体，截断到 PROXY_CAP
    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut body: Vec<u8> = Vec::new();
    let mut truncated = false;
    while let Some(item) = stream.next().await {
        match item {
            Ok(chunk) => {
                let remain = PROXY_CAP - body.len() as u64;
                if (chunk.len() as u64) > remain {
                    body.extend_from_slice(&chunk[..remain as usize]);
                    truncated = true;
                    break;
                }
                body.extend_from_slice(&chunk);
                if body.len() as u64 >= PROXY_CAP {
                    truncated = true;
                    break;
                }
            }
            Err(e) => return not_found(&format!("proxy stream error: {e}").replace('"', "'")),
        }
    }

    let builder = Response::builder()
        .header(CONTENT_TYPE, ct)
        .header(ACCEPT_RANGES, "bytes");

    // 已完整读到远端全部内容 → 200/206 原样语义；被截断 → 修正为 206 区间
    let fully_read = match (content_length, total) {
        (Some(cl), _) => body.len() as u64 >= cl,
        (None, Some(t)) => served_start + body.len() as u64 >= t,
        _ => !truncated,
    };

    match (range.is_some() || content_range.is_some(), fully_read) {
        // 无 Range 请求且读完 → 200
        (false, true) => builder
            .status(StatusCode::OK)
            .header(CONTENT_LENGTH, body.len())
            .body(body)
            .unwrap(),
        // 其余情况一律 206 + 精确 Content-Range
        _ => {
            let total_s = total.map(|t| t.to_string()).unwrap_or_else(|| "*".into());
            let served_end = served_start + body.len() as u64 - 1;
            builder
                .status(StatusCode::PARTIAL_CONTENT)
                .header(
                    CONTENT_RANGE,
                    format!("bytes {served_start}-{served_end}/{total_s}"),
                )
                .header(CONTENT_LENGTH, body.len())
                .body(body)
                .unwrap()
        }
    }
}
