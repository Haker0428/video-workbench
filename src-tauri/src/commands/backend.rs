use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::process::Command;

use crate::config::BackendConfig;
use crate::error::{AppError, AppResult};
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct BackendControlResult {
    pub backend_id: String,
    pub action: String,
    pub state: String,
    pub message: String,
}

fn valid_ssh_target(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'@' | b':'))
}

fn shares_h3_residency(a: &BackendConfig, b: &BackendConfig) -> bool {
    matches!(a.kind.as_str(), "sol_h3" | "gb10") && matches!(b.kind.as_str(), "sol_h3" | "gb10")
}

async fn run_remote(
    backend: &BackendConfig,
    command: &str,
    timeout: Duration,
) -> AppResult<String> {
    let target = backend
        .ssh_target
        .as_deref()
        .filter(|v| valid_ssh_target(v))
        .ok_or_else(|| AppError::Config(format!("{} 未配置有效的 SSH 目标", backend.label)))?;
    let output = tokio::time::timeout(
        timeout,
        Command::new("/usr/bin/ssh")
            .args([
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=8",
                "--",
                target,
                command,
            ])
            .output(),
    )
    .await
    .map_err(|_| AppError::Conn(format!("{} SSH 控制命令超时", backend.label)))?
    .map_err(|e| AppError::Conn(format!("无法启动 ssh: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Conn(if stderr.is_empty() {
            format!("{} SSH 控制命令退出: {}", backend.label, output.status)
        } else {
            format!("{}: {stderr}", backend.label)
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Start or stop the selected remote backend through the user's existing SSH setup.
/// Commands live in the local trusted config and are never assembled from HTTP input.
#[tauri::command]
pub async fn control_backend(
    state: State<'_, AppState>,
    action: String,
    backend_id: Option<String>,
) -> AppResult<BackendControlResult> {
    if action != "start" && action != "stop" {
        return Err(AppError::Invalid("action 必须是 start 或 stop".into()));
    }

    let (backend, peers) = {
        let config = state.config.lock().unwrap();
        let id = backend_id.as_deref().unwrap_or(&config.active_backend_id);
        let backend = config
            .backend(id)
            .cloned()
            .ok_or_else(|| AppError::Config(format!("后端不存在: {id}")))?;
        let peers = config
            .backends
            .iter()
            .filter(|candidate| {
                candidate.id != backend.id && shares_h3_residency(&backend, candidate)
            })
            .cloned()
            .collect::<Vec<_>>();
        (backend, peers)
    };

    let mut already_running = None;
    if action == "start" && !backend.base_url.trim().is_empty() {
        if let Ok(snapshot) = state
            .client
            .health(backend.base_url.trim_end_matches('/'))
            .await
        {
            if snapshot.status == "ready" || snapshot.status == "loading" {
                already_running = Some(snapshot.status);
            }
        }
    }

    let mut stopped = Vec::new();
    if action == "start" {
        for peer in peers {
            if !peer.base_url.trim().is_empty() {
                if let Ok(snapshot) = state
                    .client
                    .health(peer.base_url.trim_end_matches('/'))
                    .await
                {
                    if snapshot.queue_depth.unwrap_or(0) > 0 {
                        return Err(AppError::Invalid(format!(
                            "{} 仍有 {} 个排队任务，请等待完成后再切换",
                            peer.label,
                            snapshot.queue_depth.unwrap_or(0)
                        )));
                    }
                }
            }
            let stop = peer
                .stop_command
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::Config(format!("{} 未配置停止命令，无法保证后端互斥", peer.label))
                })?;
            run_remote(&peer, stop, Duration::from_secs(75)).await?;
            stopped.push(peer.label);
        }
    }

    if let Some(status) = already_running {
        return Ok(BackendControlResult {
            backend_id: backend.id,
            action,
            state: status,
            message: if stopped.is_empty() {
                "服务已经启动".into()
            } else {
                format!("已停止互斥后端：{}；当前服务已经启动", stopped.join("、"))
            },
        });
    }

    let remote_command = match action.as_str() {
        "start" => backend.start_command.as_deref(),
        "stop" => backend.stop_command.as_deref(),
        _ => None,
    }
    .filter(|v| !v.trim().is_empty())
    .ok_or_else(|| {
        AppError::Config(format!(
            "{} 未配置{}命令",
            backend.label,
            if action == "start" {
                "启动"
            } else {
                "停止"
            }
        ))
    })?;

    run_remote(&backend, remote_command, Duration::from_secs(75)).await?;

    Ok(BackendControlResult {
        backend_id: backend.id,
        action: action.clone(),
        state: if action == "start" {
            "starting"
        } else {
            "stopping"
        }
        .into(),
        message: if action == "start" {
            if stopped.is_empty() {
                "启动命令已发送，正在等待健康检查".into()
            } else {
                format!(
                    "已停止互斥后端：{}；启动命令已发送，正在等待健康检查",
                    stopped.join("、")
                )
            }
        } else {
            "停止命令已发送".into()
        },
    })
}
