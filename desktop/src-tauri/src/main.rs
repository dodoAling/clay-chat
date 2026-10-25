#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod protocol;

use protocol::{ChatInput, StreamEvent};
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct RuntimeState {
    requests: Mutex<HashMap<String, CancellationToken>>,
    storage: tokio::sync::Mutex<()>,
}

fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CLAY_CHAT_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    app.path()
        .app_data_dir()
        .map_err(|_| "无法定位应用数据目录。".into())
}

#[tauri::command]
async fn load_workspace(app: AppHandle) -> Result<Value, String> {
    let path = data_directory(&app)?.join("workspace.json");
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "本地对话文件损坏，请从导出备份恢复。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(_) => Err("无法读取本地对话。".into()),
    }
}

#[tauri::command]
async fn save_workspace(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    workspace: Value,
) -> Result<(), String> {
    if !workspace.is_object() || workspace.pointer("/settings/apiKey").is_some() {
        return Err("工作空间数据格式不正确。".into());
    }
    let data = serde_json::to_vec(&workspace).map_err(|_| "无法保存工作空间。")?;
    if data.len() > 20_000_000 {
        return Err("本地对话过大，请导出并清理部分对话。".into());
    }
    let _guard = state.storage.lock().await;
    let directory = data_directory(&app)?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|_| "无法创建本地数据目录。")?;
    let temp = directory.join("workspace.json.tmp");
    tokio::fs::write(&temp, data)
        .await
        .map_err(|_| "本地保存失败，请检查磁盘空间。")?;
    tokio::fs::rename(&temp, directory.join("workspace.json"))
        .await
        .map_err(|_| "无法更新本地对话文件。".into())
}

fn credential() -> Result<keyring::Entry, String> {
    let identity = std::env::var("CLAY_CHAT_DATA_DIR").unwrap_or_else(|_| "api-key".into());
    keyring::Entry::new("app.claychat.desktop", &identity)
        .map_err(|_| "系统凭据服务不可用。".into())
}

#[tauri::command]
async fn load_secret() -> Result<String, String> {
    tokio::task::spawn_blocking(|| match credential()?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(_) => Err("无法读取系统保存的 API Key。".into()),
    })
    .await
    .map_err(|_| "系统凭据服务不可用。")?
}

#[tauri::command]
async fn save_secret(value: String) -> Result<(), String> {
    if value.len() > 8192 {
        return Err("API Key 过长。".into());
    }
    tokio::task::spawn_blocking(move || {
        let entry = credential()?;
        if value.is_empty() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err("无法清除系统保存的凭据。".into()),
            }
        } else {
            entry
                .set_password(&value)
                .map_err(|_| "系统加密保存不可用，Key 仅在当前会话中使用。".into())
        }
    })
    .await
    .map_err(|_| "系统凭据服务不可用。")?
}

#[tauri::command]
async fn export_markdown(app: AppHandle, name: String, content: String) -> Result<bool, String> {
    if content.len() > 20_000_000 {
        return Err("导出内容过大。".into());
    }
    let name = PathBuf::from(name)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "conversation.md".into());
    let selected = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(name)
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
    })
    .await
    .map_err(|_| "无法打开导出窗口。")?;
    let Some(selected) = selected else {
        return Ok(false);
    };
    let path = selected.into_path().map_err(|_| "导出路径不受支持。")?;
    tokio::fs::write(path, content)
        .await
        .map_err(|_| "导出失败，请检查保存位置。")?;
    Ok(true)
}

#[tauri::command]
async fn chat_stream(
    state: State<'_, RuntimeState>,
    request_id: String,
    input: ChatInput,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("请求 ID 不正确。".into());
    }
    let cancellation = CancellationToken::new();
    {
        let mut requests = state.requests.lock().map_err(|_| "请求状态不可用。")?;
        if requests.contains_key(&request_id) {
            return Err("请求正在进行中。".into());
        }
        requests.insert(request_id.clone(), cancellation.clone());
    }
    let result = tokio::select! {
        _ = cancellation.cancelled() => Err("请求已取消。".to_owned()),
        result = protocol::run_chat(&input, cancellation.clone(), |event| {
            on_event.send(event).map_err(|_| "对话窗口已关闭。".into())
        }) => result,
    };
    if let Ok(mut requests) = state.requests.lock() {
        requests.remove(&request_id);
    }
    result.map_err(|error| {
        let message = if input.api_key.is_empty() {
            error
        } else {
            error.replace(&input.api_key, "[已隐藏]")
        };
        message.chars().take(600).collect()
    })
}

#[tauri::command]
fn cancel_chat(state: State<'_, RuntimeState>, request_id: String) {
    if let Ok(requests) = state.requests.lock() {
        if let Some(request) = requests.get(&request_id) {
            request.cancel();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            load_secret,
            save_secret,
            export_markdown,
            chat_stream,
            cancel_chat
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Clay Chat");
}
