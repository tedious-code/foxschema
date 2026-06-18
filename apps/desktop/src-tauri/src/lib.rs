use std::collections::HashMap;
use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;

use rand::RngCore;
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the resolved API base (sidecar URL) and the sidecar handle so we can
/// expose the URL to the frontend and kill the process on exit.
struct SidecarState {
    api_base: String,
    child: Mutex<Option<CommandChild>>,
}

/// Frontend calls this (via window.__TAURI__.core.invoke) to learn where the
/// Node sidecar is listening, since the port is chosen dynamically.
#[tauri::command]
fn get_api_base(state: State<SidecarState>) -> String {
    state.api_base.clone()
}

/// Pick a free localhost port by binding to :0 and reading it back.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind ephemeral port")
        .local_addr()
        .expect("local_addr")
        .port()
}

/// Load the per-install AES key (64 hex chars) from app-data, creating it on
/// first run. The desktop app is the trust boundary; this protects stored DB
/// credentials at rest. (A keychain-backed store is a planned upgrade.)
fn load_or_create_key(data_dir: &PathBuf) -> String {
    let key_path = data_dir.join("encryption.key");
    if let Ok(existing) = fs::read_to_string(&key_path) {
        let trimmed = existing.trim().to_string();
        if trimmed.len() == 64 {
            return trimmed;
        }
    }
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let _ = fs::write(&key_path, &hex);
    hex
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Per-install state lives in the OS app-data dir.
            let data_dir = app.path().app_data_dir().expect("app data dir");
            fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("foxschema.db");
            let key = load_or_create_key(&data_dir);

            let port = free_port();
            let api_base = format!("http://localhost:{}/api", port);

            // The bundled server lives in resources/server. In dev resolve it
            // from the crate dir so `tauri dev` works against the build output.
            let server_js: PathBuf = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/server/server.mjs")
            } else {
                app.path()
                    .resource_dir()
                    .expect("resource dir")
                    .join("resources/server/server.mjs")
            };

            let mut envs: HashMap<String, String> = HashMap::new();
            envs.insert("EDITION".into(), "community".into());
            envs.insert("NODE_ENV".into(), "production".into());
            envs.insert("AUTH_REQUIRED".into(), "false".into());
            envs.insert("API_PORT".into(), port.to_string());
            envs.insert("APP_DB_PATH".into(), db_path.to_string_lossy().to_string());
            envs.insert("APP_ENCRYPTION_KEY".into(), key);

            let (mut rx, child) = app
                .shell()
                .sidecar("foxschema-sidecar")
                .expect("sidecar command")
                .arg(server_js.to_string_lossy().to_string())
                .envs(envs)
                .spawn()
                .expect("spawn sidecar");

            // Pipe sidecar logs into the app log.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            log::warn!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        _ => {}
                    }
                }
            });

            app.manage(SidecarState {
                api_base,
                child: Mutex::new(Some(child)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_api_base])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Make sure the sidecar dies with the app.
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<SidecarState>() {
                    if let Some(child) = state.child.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
