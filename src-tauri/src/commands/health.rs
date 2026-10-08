use tauri::State;

use crate::error::{AppError, AppResult};
use crate::h3::types::HealthSnapshot;
use crate::AppState;

/// 透传 /health。网络不可达时返回 Err（前端视为已断开）；
/// 服务启动失败（503）正常返回快照，status 字段为 "error"。
///
/// target: active backend（默认）| "ref2va" | backend id。
/// ref2va 未配置时返回 Err(Config)。
#[tauri::command]
pub async fn get_health(
    state: State<'_, AppState>,
    target: Option<String>,
) -> AppResult<HealthSnapshot> {
    let base = {
        let config = state.config.lock().unwrap();
        match target.as_deref() {
            Some("ref2va") => config
                .ref2va_base()
                .ok_or_else(|| AppError::Config("Ref2VA 服务未配置".into()))?
                .to_string(),
            Some(id) => config
                .backend(id)
                .filter(|b| !b.base_url.trim().is_empty())
                .map(|b| b.base_url.trim_end_matches('/').to_string())
                .ok_or_else(|| AppError::Config(format!("后端未配置: {id}")))?,
            None => {
                let base = config.base().to_string();
                if base.is_empty() {
                    return Err(AppError::Config("当前后端尚未配置 API 地址".into()));
                }
                base
            }
        }
    };
    state.client.health(&base).await
}
