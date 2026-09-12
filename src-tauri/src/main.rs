// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Emitter;

use tauri::{async_runtime::Mutex as AsyncMutex, State, Window};

#[allow(dead_code)]
mod descrypt;
#[allow(dead_code)]
mod net;

struct Session {
    master: Arc<StdMutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<StdMutex<Box<dyn Write + Send>>>,
    child: Arc<StdMutex<Box<dyn Child + Send + Sync>>>,
    is_closed: Arc<AtomicBool>,
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

#[derive(Serialize, Clone)]
struct PtyLatencyEvent {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "rttMs")]
    rtt_ms: u64,
}

fn pty_event(session_id: &str) -> PtyEvent {
    PtyEvent {
        session_id: session_id.to_string(),
        data: None,
        message: None,
    }
}

fn measure_latency_sync(
    host: &str,
    port: u16,
    proxy_address: &str,
    proxy_port: &str,
    proxy_auth_enabled: bool,
    proxy_username: &str,
    proxy_password: &str,
) -> Option<u64> {
    let timeout = Duration::from_secs(3);
    let start = Instant::now();

    if !proxy_port.is_empty() {
        let proxy_host = if proxy_address.is_empty() {
            "127.0.0.1"
        } else {
            proxy_address
        };
        let proxy_addr_str = format!("{}:{}", proxy_host, proxy_port);
        let proxy_addrs = proxy_addr_str.to_socket_addrs().ok()?.next()?;
        let mut stream = TcpStream::connect_timeout(&proxy_addrs, timeout).ok()?;
        let _ = stream.set_read_timeout(Some(timeout));
        let _ = stream.set_write_timeout(Some(timeout));

        // SOCKS5 Greeting
        if proxy_auth_enabled && !proxy_username.is_empty() {
            stream.write_all(&[0x05, 0x02, 0x00, 0x02]).ok()?;
        } else {
            stream.write_all(&[0x05, 0x01, 0x00]).ok()?;
        }

        let mut greeting_resp = [0u8; 2];
        stream.read_exact(&mut greeting_resp).ok()?;
        let [socks_ver, auth_method] = greeting_resp;
        if socks_ver != 0x05 {
            return None;
        }

        if auth_method == 0x02 {
            // Username/password auth
            let u_bytes = proxy_username.as_bytes();
            let p_bytes = proxy_password.as_bytes();
            let mut auth_req = Vec::with_capacity(3 + u_bytes.len() + p_bytes.len());
            auth_req.push(0x01); // Auth subnegotiation version
            auth_req.push(u_bytes.len() as u8);
            auth_req.extend_from_slice(u_bytes);
            auth_req.push(p_bytes.len() as u8);
            auth_req.extend_from_slice(p_bytes);
            stream.write_all(&auth_req).ok()?;

            let mut auth_resp = [0u8; 2];
            stream.read_exact(&mut auth_resp).ok()?;
            let [_auth_ver, auth_status] = auth_resp;
            if auth_status != 0x00 {
                return None;
            }
        } else if auth_method != 0x00 {
            return None;
        }

        // SOCKS5 CONNECT request
        let host_bytes = host.as_bytes();
        let mut connect_req = Vec::with_capacity(7 + host_bytes.len());
        connect_req.extend_from_slice(&[0x05, 0x01, 0x00, 0x03]); // CMD=CONNECT, RSV=0, ATYP=DOMAINNAME
        connect_req.push(host_bytes.len() as u8);
        connect_req.extend_from_slice(host_bytes);
        connect_req.extend_from_slice(&port.to_be_bytes());
        stream.write_all(&connect_req).ok()?;

        // SOCKS5 response header: VER, REP, RSV, ATYP
        let mut connect_resp = [0u8; 4];
        stream.read_exact(&mut connect_resp).ok()?;
        let [ver, rep, ..] = connect_resp;
        if ver != 0x05 || rep != 0x00 {
            return None;
        }

        Some(start.elapsed().as_millis() as u64)
    } else {
        let addr_str = format!("{}:{}", host, port);
        let addrs = addr_str.to_socket_addrs().ok()?.next()?;
        let _stream = TcpStream::connect_timeout(&addrs, timeout).ok()?;
        Some(start.elapsed().as_millis() as u64)
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

    let is_closed = Arc::new(AtomicBool::new(false));
    let is_closed_prober = is_closed.clone();

    let master = Arc::new(StdMutex::new(pty_pair.master));
    let writer = Arc::new(StdMutex::new(writer));
    let child = Arc::new(StdMutex::new(child));

    state.sessions.lock().await.insert(
        session_id.clone(),
        Session {
            master,
            writer,
            child,
            is_closed,
        },
    );

    // Background latency prober: runs every 4s while session is active
    let prober_window = window.clone();
    let prober_session_id = session_id.clone();
    let prober_host = host.clone();
    let prober_port = port.parse::<u16>().unwrap_or(22);
    let prober_proxy_addr = proxy_address.clone();
    let prober_proxy_port = proxy_port.clone();
    let prober_proxy_auth = proxy_auth_enabled;
    let prober_proxy_user = proxy_username.clone();
    let prober_proxy_pass = proxy_password.clone();

    thread::spawn(move || loop {
        if is_closed_prober.load(Ordering::Relaxed) {
            break;
        }

        if let Some(rtt_ms) = measure_latency_sync(
            &prober_host,
            prober_port,
            &prober_proxy_addr,
            &prober_proxy_port,
            prober_proxy_auth,
            &prober_proxy_user,
            &prober_proxy_pass,
        ) {
            if is_closed_prober.load(Ordering::Relaxed) {
                break;
            }
            let _ = prober_window.emit(
                "pty:latency",
                PtyLatencyEvent {
                    session_id: prober_session_id.clone(),
                    rtt_ms,
                },
            );
        }

        thread::sleep(Duration::from_secs(4));
    });

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
        let removed = {
            let mut guard = sessions.blocking_lock();
            guard.remove(&thread_session_id)
        };
        if let Some(session) = removed {
            session.is_closed.store(true, Ordering::Relaxed);
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
    let writer = {
        let sessions = state.sessions.lock().await;
        sessions.get(&session_id).map(|s| s.writer.clone())
    };
    if let Some(writer) = writer {
        let data = data.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let mut writer = writer.lock().map_err(|e| format!("Lock error: {}", e))?;
            writer
                .write_all(data.as_bytes())
                .and_then(|_| writer.flush())
                .map_err(|e| format!("Failed to write to PTY: {}", e))
        })
        .await
        .map_err(|e| format!("Join error: {}", e))?
    } else {
        Err(format!("No session {}", session_id))
    }
}

#[tauri::command]
async fn async_resize_pty(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let master = {
        let sessions = state.sessions.lock().await;
        sessions.get(&session_id).map(|s| s.master.clone())
    };
    if let Some(master) = master {
        tauri::async_runtime::spawn_blocking(move || {
            let master = master.lock().map_err(|e| format!("Lock error: {}", e))?;
            master
                .resize(PtySize {
                    rows,
                    cols,
                    ..Default::default()
                })
                .map_err(|e| format!("Failed to resize PTY: {}", e))
        })
        .await
        .map_err(|e| format!("Join error: {}", e))?
    } else {
        Err(format!("No session {}", session_id))
    }
}

#[tauri::command]
async fn async_terminate_shell(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Remove first so the reader thread treats EOF as explicit termination.
    let session = state.sessions.lock().await.remove(&session_id);
    if let Some(session) = session {
        session.is_closed.store(true, Ordering::Relaxed);
        let child = session.child.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
        })
        .await
        .map_err(|e| format!("Join error: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn is_test_server() -> bool {
    std::env::args().any(|arg| arg == "--test-server" || arg == "test")
}

#[tauri::command]
fn validate_descrypt_hash(hash: String) -> Result<(), String> {
    descrypt::validate(&hash)
}

#[tauri::command]
fn crack_descrypt_hash(hash: String, candidates: Vec<Vec<u8>>) -> Result<Option<Vec<u8>>, String> {
    descrypt::crack(&hash, candidates)
}

#[tauri::command]
async fn save_file_dialog(
    default_name: Option<String>,
    content: String,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .add_filter("Text Files", &["txt", "log"] as &[&str])
        .add_filter("All Files", &["*"] as &[&str]);

    if let Some(ref name) = default_name {
        dialog = dialog.set_file_name(name);
    }

    if let Some(file) = dialog.save_file().await {
        let path = file.path().to_path_buf();
        std::fs::write(&path, content.as_bytes())
            .map_err(|e| format!("Failed to write file: {}", e))?;
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn find_shortest_path(
    from_host: String,
    to_host: String,
    undirected: Option<bool>,
) -> Result<Vec<String>, String> {
    let map = net::global();
    let path = if undirected.unwrap_or(false) {
        map.shortest_path_undirected(&from_host, &to_host)
    } else {
        map.shortest_path(&from_host, &to_host)
    };

    path.ok_or_else(|| format!("No path found from '{}' to '{}'", from_host, to_host))
}

#[tauri::command]
fn get_host_info(hostname: String) -> Result<net::HostInfo, String> {
    net::global()
        .get_host(&hostname)
        .cloned()
        .ok_or_else(|| format!("Host '{}' not found", hostname))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            sessions: Arc::new(AsyncMutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            async_write_to_pty,
            async_resize_pty,
            async_create_shell,
            async_terminate_shell,
            is_test_server,
            validate_descrypt_hash,
            crack_descrypt_hash,
            save_file_dialog,
            find_shortest_path,
            get_host_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
