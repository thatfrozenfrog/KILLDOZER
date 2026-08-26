// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::Emitter;
use portable_pty::{native_pty_system, Child, CommandBuilder, PtyPair, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    sync::Arc,
    thread,
};

use tauri::{async_runtime::Mutex as AsyncMutex, State, Window};

struct Session {
    pty_pair: PtyPair,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

type Registry = Arc<AsyncMutex<HashMap<String, Session>>>;

struct AppState {
    sessions: Registry,
}

#[derive(Serialize, Clone)]
struct PtyEvent {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn pty_event(session_id: &str) -> PtyEvent {
    PtyEvent {
        session_id: session_id.to_string(),
        data: None,
        message: None,
    }
}

#[tauri::command]
async fn async_create_shell(
    session_id: String,
    username: String,
    host: String,
    port: String,
    proxy_address: String,
    proxy_port: String,
    proxy_auth_enabled: bool,
    proxy_username: String,
    proxy_password: String,
    state: State<'_, AppState>,
    window: Window,
) -> Result<(), String> {
    if let Err(err) = create_shell_inner(
        session_id.clone(),
        username,
        host,
        port,
        proxy_address,
        proxy_port,
        proxy_auth_enabled,
        proxy_username,
        proxy_password,
        &state,
        &window,
    )
    .await
    {
        let mut evt = pty_event(&session_id);
        evt.message = Some(err.clone());
        let _ = window.emit("pty:error", evt);
        return Err(err);
    }
    Ok(())
}

async fn create_shell_inner(
    session_id: String,
    username: String,
    host: String,
    port: String,
    proxy_address: String,
    proxy_port: String,
    proxy_auth_enabled: bool,
    proxy_username: String,
    proxy_password: String,
    state: &State<'_, AppState>,
    window: &Window,
) -> Result<(), String> {
    // Reject duplicate session IDs without touching the existing session
    if state.sessions.lock().await.contains_key(&session_id) {
        return Err(format!("Session {} already exists", session_id));
    }

    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    let target = format!("{}@{}", username, host);
    let mut cmd = if cfg!(target_os = "windows") {
        CommandBuilder::new("ssh.exe")
    } else {
        CommandBuilder::new("ssh")
    };

    cmd.arg("-p");
    cmd.arg(&port);

    if !proxy_port.is_empty() {
        let proxy_host = if proxy_address.is_empty() {
            "127.0.0.1".to_string()
        } else {
            proxy_address.clone()
        };
        cmd.arg("-o");
        if proxy_auth_enabled {
            cmd.arg(format!(
                "ProxyCommand=ncat --proxy {}:{} --proxy-type socks5 --proxy-auth {}:{} %h %p",
                proxy_host, proxy_port, proxy_username, proxy_password
            ));
        } else {
            cmd.arg(format!(
                "ProxyCommand=ncat --proxy {}:{} --proxy-type socks5 %h %p",
                proxy_host, proxy_port
            ));
        }
    }

    cmd.arg(&target);

    #[cfg(target_os = "windows")]
    cmd.env("TERM", "cygwin");

    #[cfg(not(target_os = "windows"))]
    cmd.env("TERM", "xterm-256color");

    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| format!("Failed to spawn SSH: {}", err))?;

    state.sessions.lock().await.insert(
        session_id.clone(),
        Session {
            pty_pair,
            writer,
            child,
        },
    );

    // Background reader thread owns the reader; on EOF it removes the
    // registry entry (if still present) and emits pty:exit for this session.
    let sessions = state.sessions.clone();
    let session_window = window.clone();
    let thread_session_id = session_id.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        loop {
            let buf = match reader.fill_buf() {
                Ok(buf) => buf,
                Err(_) => break,
            };
            if buf.is_empty() {
                break;
            }
            let data = String::from_utf8_lossy(buf).to_string();
            let len = buf.len();
            reader.consume(len);
            if !data.is_empty() {
                let mut evt = pty_event(&thread_session_id);
                evt.data = Some(data);
                let _ = session_window.emit("pty:data", evt);
            }
        }

        // Only emit exit when we removed the entry ourselves (unexpected
        // exit). An explicit terminate removes the entry first.
        if sessions
            .blocking_lock()
            .remove(&thread_session_id)
            .is_some()
        {
            let _ = session_window.emit("pty:exit", pty_event(&thread_session_id));
        }
    });

    let _ = window.emit("pty:ready", pty_event(&session_id));

    Ok(())
}

#[tauri::command]
async fn async_write_to_pty(
    session_id: String,
    data: &str,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().await;
    match sessions.get_mut(&session_id) {
        Some(session) => session
            .writer
            .write_all(data.as_bytes())
            .and_then(|_| session.writer.flush())
            .map_err(|e| format!("Failed to write to PTY: {}", e)),
        None => Err(format!("No session {}", session_id)),
    }
}

#[tauri::command]
async fn async_resize_pty(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    match sessions.get(&session_id) {
        Some(session) => session
            .pty_pair
            .master
            .resize(PtySize {
                rows,
                cols,
                ..Default::default()
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e)),
        None => Err(format!("No session {}", session_id)),
    }
}

#[tauri::command]
async fn async_terminate_shell(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    // Remove first so the reader thread treats EOF as explicit termination.
    if let Some(mut session) = state.sessions.lock().await.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            sessions: Arc::new(AsyncMutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            async_write_to_pty,
            async_resize_pty,
            async_create_shell,
            async_terminate_shell
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
