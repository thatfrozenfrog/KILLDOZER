// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use portable_pty::{native_pty_system, Child, CommandBuilder, PtyPair, PtySize};
use std::{
    io::{BufRead, BufReader, Read, Write},
    sync::Arc,
    thread::{self},
};

use tauri::{async_runtime::Mutex as AsyncMutex, State, Window};

struct AppState {
    pty_pair: Arc<AsyncMutex<Option<PtyPair>>>,
    writer: Arc<AsyncMutex<Option<Box<dyn Write + Send>>>>,
    reader: Arc<AsyncMutex<Option<BufReader<Box<dyn Read + Send>>>>>,
    child: Arc<AsyncMutex<Option<Box<dyn Child + Send + Sync>>>>,
}

#[tauri::command]
async fn async_create_shell(
    username: String,
    host: String,
    port: String,
    state: State<'_, AppState>,
    window: Window,
) -> Result<(), String> {
    // Create a fresh PTY for this connection
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer = pty_pair.master.take_writer().map_err(|e| e.to_string())?;

    let target = format!("{}@{}", username, host);
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = CommandBuilder::new("ssh.exe");
        c.arg("-p");
        c.arg(port.clone());
        c.arg(&target);
        c
    } else {
        let mut c = CommandBuilder::new("ssh");
        c.arg("-p");
        c.arg(port);
        c.arg(&target);
        c
    };

    #[cfg(target_os = "windows")]
    cmd.env("TERM", "cygwin");

    #[cfg(not(target_os = "windows"))]
    cmd.env("TERM", "xterm-256color");

    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| err.to_string())?;

    // Store the new PTY pair, writer, reader, and child
    *state.pty_pair.lock().await = Some(pty_pair);
    *state.writer.lock().await = Some(writer);
    *state.reader.lock().await = Some(BufReader::new(reader));
    *state.child.lock().await = Some(child);

    // Start reading from PTY in a background thread
    let reader = state.reader.clone();
    let session_window = window.clone();
    let _ready_window = window.clone();
    
    thread::spawn(move || {
        loop {
            let data = {
                let mut reader_guard = match reader.try_lock() {
                    Ok(guard) => guard,
                    Err(_) => {
                        thread::sleep(std::time::Duration::from_millis(10));
                        continue;
                    }
                };

                if reader_guard.is_none() {
                    break;
                }
                
                let reader_ref = reader_guard.as_mut().unwrap();
                
                let buf = match reader_ref.fill_buf() {
                    Ok(buf) => buf,
                    Err(_) => break,
                };

                if buf.len() == 0 {
                    thread::sleep(std::time::Duration::from_millis(10));
                    continue;
                }

                let data = std::str::from_utf8(buf).unwrap_or("").to_string();
                let len = buf.len();
                reader_ref.consume(len);
                data
            };

            if !data.is_empty() {
                let _ = session_window.emit("pty:data", data);
            }
        }
        
        let _ = session_window.emit("pty:exit", ());
    });
    
    // Signal that the shell is ready
    let _ = window.emit("pty:ready", ());

    
    Ok(())
}

#[tauri::command]
async fn async_write_to_pty(data: &str, state: State<'_, AppState>) -> Result<(), ()> {
    let mut writer_guard = state.writer.lock().await;
    if let Some(writer) = writer_guard.as_mut() {
        write!(writer, "{}", data).map_err(|_| ())?;
    }
    Ok(())
}

#[tauri::command]
async fn async_resize_pty(rows: u16, cols: u16, state: State<'_, AppState>) -> Result<(), ()> {
    let mut pty_guard = state.pty_pair.lock().await;
    if let Some(pty) = pty_guard.as_mut() {
        pty.master
            .resize(PtySize {
                rows,
                cols,
                ..Default::default()
            })
            .map_err(|_| ())?;
    }
    Ok(())
}

#[tauri::command]
async fn async_terminate_shell(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().await.take() {
        let _ = child.kill();
    }


    thread::sleep(std::time::Duration::from_millis(100));
    

    *state.pty_pair.lock().await = None;
    
    thread::sleep(std::time::Duration::from_millis(50));

    *state.reader.lock().await = None;
    

    *state.writer.lock().await = None;
    
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            pty_pair: Arc::new(AsyncMutex::new(None)),
            writer: Arc::new(AsyncMutex::new(None)),
            reader: Arc::new(AsyncMutex::new(None)),
            child: Arc::new(AsyncMutex::new(None)),
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