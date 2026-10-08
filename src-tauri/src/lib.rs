mod archiver;
mod chat;
mod commands;
mod config;
mod error;
mod h3;
mod protocol;
mod store;
mod util;

use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::archiver::Archiver;
use crate::chat::ChatStore;
use crate::config::Settings;
use crate::h3::H3Client;
use crate::store::TaskStore;

/// 全局应用状态。
pub struct AppState {
    pub data_dir: std::path::PathBuf,
    pub config: Mutex<Settings>,
    pub store: Mutex<TaskStore>,
    pub chat: Mutex<ChatStore>,
    pub client: H3Client,
    pub archiver: Arc<Archiver>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            for sub in ["", "frames", "videos", "thumbs", "refs"] {
                std::fs::create_dir_all(data_dir.join(sub))?;
            }
            let settings = config::load_config(&data_dir)?;
            settings.validate()?;
            let tasks = TaskStore::load(&data_dir)?;
            let chats = chat::ChatStore::load(&data_dir)?;

            let archiver = Arc::new(Archiver::default());
            app.manage(Arc::clone(&archiver));
            app.manage(AppState {
                data_dir,
                config: Mutex::new(settings),
                store: Mutex::new(tasks),
                chat: Mutex::new(chats),
                client: H3Client::new(),
                archiver,
            });
            Ok(())
        });
    let builder = protocol::register(builder);
    builder
        .invoke_handler(tauri::generate_handler![
            commands::backend::control_backend,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::health::get_health,
            commands::tasks::list_tasks,
            commands::tasks::submit_task,
            commands::tasks::poll_tasks,
            commands::tasks::delete_task,
            commands::tasks::save_thumbnail,
            commands::tasks::archive_task,
            commands::tasks::reveal_task_files,
            commands::tasks::export_task_video,
            commands::tasks::save_frame,
            commands::tasks::save_ref_video,
            commands::tasks::save_ref_audio,
            commands::tasks::get_runtime_info,
            commands::chat::list_chats,
            commands::chat::save_chat,
            commands::chat::delete_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
