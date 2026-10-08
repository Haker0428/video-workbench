use tauri::State;

use crate::chat::ChatSession;
use crate::error::AppResult;
use crate::AppState;

#[tauri::command]
pub fn list_chats(state: State<'_, AppState>) -> Vec<ChatSession> {
    state.chat.lock().unwrap().sessions.clone()
}

/// 整体保存会话（前端为单一写入方，简单整体 upsert）。
#[tauri::command]
pub fn save_chat(state: State<'_, AppState>, session: ChatSession) -> AppResult<()> {
    state.chat.lock().unwrap().upsert(session)
}

#[tauri::command]
pub fn delete_chat(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.chat.lock().unwrap().remove(&id)
}
