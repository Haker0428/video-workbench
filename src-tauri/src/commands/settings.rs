use tauri::State;

use crate::config::{save_config, Settings};
use crate::error::AppResult;
use crate::AppState;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    settings.validate()?;
    save_config(&state.data_dir, &settings)?;
    *state.config.lock().unwrap() = settings.clone();
    Ok(settings)
}
