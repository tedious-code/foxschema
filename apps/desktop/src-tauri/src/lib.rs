use std::collections::HashMap;
use std::fs;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use rand::RngExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Keychain service the per-install Data Encryption Key (DEK) is stored under;
/// the account is the user's email, so the key is both machine- and email-bound.
const KEY_SERVICE: &str = "com.foxschema.desktop.dek";

/// Keychain service recording which SQLite metadata DBs THIS machine has bound.
/// Separate from KEY_SERVICE (and not email-keyed) so it works before any email
/// is known and never mixes with the encryption key material.
const INSTALL_BINDING_SERVICE: &str = "com.foxschema.desktop.install-binding";
const INSTALL_BINDING_ACCOUNT: &str = "machine";

/// Persisted (non-secret) first-run state in app-data/setup.json. The secret
/// (the DEK) is NOT here — it lives only in the OS keychain.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)] // tolerate older setup.json missing newer fields
struct SetupInfo {
    setup_complete: bool,
    email: String,
    db_engine: String, // "sqlite" | "postgres" | "mysql"
    db_path: String,   // sqlite file location
    db_url: String,    // postgres/mysql connection string
    key_scheme: String, // "v1" (legacy/migrated, raw key) | "v2" (email-bound)
}

/// What the frontend needs to decide between the setup screen and the app.
#[derive(Serialize, Clone)]
struct SetupState {
    setup_complete: bool,
    email: String,
    db_engine: String,
    db_path: String,
    db_url: String,
    default_db_path: String,
    api_base: String,
    sidecar_ready: bool,
}

struct AppState {
    data_dir: PathBuf,
    default_db_path: String,
    setup: Mutex<SetupInfo>,
    api_base: Mutex<String>,
    child: Mutex<Option<CommandChild>>,
}

/// Pick a free localhost port by binding to :0 and reading it back.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind ephemeral port")
        .local_addr()
        .expect("local_addr")
        .port()
}

/// Block until the sidecar's TCP port accepts connections, or `timeout` elapses.
/// `spawn_sidecar` only hands `api_base` to the frontend once this returns, so
/// the earliest requests (e.g. the auto "load saved connections" on boot) don't
/// race a Node process that's still starting up and get a spurious
/// connection-refused ("TypeError: Load failed" in the webview).
fn wait_for_port_ready(port: u16, timeout: Duration) {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    log::warn!("sidecar on port {port} did not become ready within {timeout:?}");
}

fn random_key_hex() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn setup_path(dir: &PathBuf) -> PathBuf {
    dir.join("setup.json")
}

fn read_setup(dir: &PathBuf) -> SetupInfo {
    fs::read_to_string(setup_path(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_setup(dir: &PathBuf, info: &SetupInfo) -> Result<(), String> {
    let json = serde_json::to_string_pretty(info).map_err(|e| e.to_string())?;
    fs::write(setup_path(dir), json).map_err(|e| e.to_string())
}

fn keychain_get(account: &str) -> Option<String> {
    keyring::Entry::new(KEY_SERVICE, account)
        .ok()?
        .get_password()
        .ok()
}

fn keychain_set(account: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(KEY_SERVICE, account)
        .map_err(|e| e.to_string())?
        .set_password(value)
        .map_err(|e| e.to_string())
}

/// IDs of every SQLite metadata DB this machine has ever bound (a machine may
/// legitimately point at more than one local DB over its lifetime, e.g. via
/// Settings → Database, so this is a set, not a single value).
fn install_binding_ids() -> Vec<String> {
    keyring::Entry::new(INSTALL_BINDING_SERVICE, INSTALL_BINDING_ACCOUNT)
        .ok()
        .and_then(|e| e.get_password().ok())
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn install_binding_add(id: &str) -> Result<(), String> {
    let mut ids = install_binding_ids();
    if !ids.iter().any(|i| i == id) {
        ids.push(id.to_string());
    }
    let json = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    keyring::Entry::new(INSTALL_BINDING_SERVICE, INSTALL_BINDING_ACCOUNT)
        .map_err(|e| e.to_string())?
        .set_password(&json)
        .map_err(|e| e.to_string())
}

/// Verify (and, for a virgin DB, establish) that `db_path` belongs to this
/// machine, by running the sidecar's `--check-install-binding` mode against it
/// BEFORE the real sidecar is spawned. Only applies to the sqlite engine —
/// Postgres/MySQL are server-side, not portable by copying a file.
///
/// A DB with no marker yet is adopted (this machine's list gains its id) — this
/// covers both a genuinely fresh database and a pre-existing install upgrading
/// to this feature for the first time, so neither is disrupted. A DB that
/// already carries a marker must appear in this machine's list, or the DB was
/// bound elsewhere and is refused. There is deliberately no recovery path (the
/// same tradeoff the existing keychain-bound encryption key already makes) —
/// that refusal is the point of this check.
async fn enforce_install_binding(app: &AppHandle, engine: &str, db_path: &str) -> Result<(), String> {
    if engine != "sqlite" {
        return Ok(());
    }
    let server_js = resolve_server_js(app);
    let mut envs: HashMap<String, String> = HashMap::new();
    envs.insert("APP_DB_ENGINE".into(), "sqlite".into());
    envs.insert("APP_DB_PATH".into(), db_path.to_string());

    let output = app
        .shell()
        .sidecar("foxschema-sidecar")
        .map_err(|e| e.to_string())?
        .arg(server_js.to_string_lossy().to_string())
        .arg("--check-install-binding")
        .envs(envs)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        log::error!(
            "[install-binding] sidecar exited {:?} — stdout: {} stderr: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return Err("Could not read the selected database to verify it. If you just \
             downloaded this app, macOS Gatekeeper may be blocking the bundled helper \
             process from running. Open Terminal and run: xattr -cr \"/Applications/Fox \
             Schema.app\" (adjust the path if installed elsewhere), then reopen the app."
            .into());
    }
    // Tolerate any incidental log noise on stdout — the check prints exactly one
    // JSON line, always last. Trim the *whole* capture before splitting: the
    // sidecar's stdout can arrive with more than one trailing newline (seen
    // under tauri_plugin_shell's capture, though not from a direct shell
    // invocation of the same command) — `.lines().last()` on untrimmed input
    // would then return an empty final "line" instead of the JSON.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.trim().lines().last().unwrap_or("").trim();
    let report: serde_json::Value = serde_json::from_str(line).map_err(|parse_err| {
        log::error!(
            "[install-binding] non-JSON sidecar output — parse error: {parse_err} — line ({} bytes): {line:?} — full stdout: {stdout:?} stderr: {}",
            line.len(),
            String::from_utf8_lossy(&output.stderr)
        );
        "Could not verify the selected database.".to_string()
    })?;
    if report.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(report
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Could not verify the selected database.")
            .to_string());
    }
    let Some(db_id) = report.get("id").and_then(|v| v.as_str()) else {
        return Ok(()); // skipped (non-sqlite) — nothing to bind
    };

    if install_binding_ids().iter().any(|i| i == db_id) {
        return Ok(());
    }
    if report.get("generated").and_then(|v| v.as_bool()) == Some(true) {
        // Virgin DB — this call just minted its id. Adopt it for this machine.
        return install_binding_add(db_id);
    }
    Err("This database was set up on a different computer and can't be opened here. \
         Choose a different database file to continue."
        .into())
}

/// Where the bundled Node server lives (crate dir in dev, resources in release).
fn resolve_server_js(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/server/server.mjs")
    } else {
        app.path()
            .resource_dir()
            .expect("resource dir")
            .join("resources/server/server.mjs")
    }
}

fn build_setup_state(state: &AppState, api_base: &str) -> SetupState {
    let s = state.setup.lock().unwrap();
    SetupState {
        setup_complete: s.setup_complete,
        email: s.email.clone(),
        db_engine: if s.db_engine.is_empty() { "sqlite".into() } else { s.db_engine.clone() },
        db_path: if s.db_path.is_empty() {
            state.default_db_path.clone()
        } else {
            s.db_path.clone()
        },
        db_url: s.db_url.clone(),
        default_db_path: state.default_db_path.clone(),
        api_base: api_base.to_string(),
        sidecar_ready: !api_base.is_empty(),
    }
}

/// Spawn (or respawn) the Node sidecar with the resolved key/email/db env.
fn spawn_sidecar(app: &AppHandle, state: &AppState, dek: &str) -> Result<String, String> {
    // Never run two sidecars; replace any existing one.
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }

    let setup = state.setup.lock().unwrap().clone();
    let port = free_port();
    let api_base = format!("http://localhost:{}/api", port);
    let server_js = resolve_server_js(app);

    let mut envs: HashMap<String, String> = HashMap::new();
    envs.insert("EDITION".into(), "community".into());
    envs.insert("NODE_ENV".into(), "production".into());
    envs.insert("AUTH_REQUIRED".into(), "false".into());
    envs.insert("API_PORT".into(), port.to_string());
    envs.insert(
        "APP_DB_ENGINE".into(),
        if setup.db_engine.is_empty() {
            "sqlite".into()
        } else {
            setup.db_engine.clone()
        },
    );
    envs.insert(
        "APP_DB_PATH".into(),
        if setup.db_path.is_empty() {
            state.default_db_path.clone()
        } else {
            setup.db_path.clone()
        },
    );
    if !setup.db_url.is_empty() {
        envs.insert("APP_DB_URL".into(), setup.db_url.clone());
    }
    envs.insert("APP_ENCRYPTION_KEY".into(), dek.to_string());
    if !setup.email.is_empty() {
        envs.insert("APP_USER_EMAIL".into(), setup.email.clone());
    }
    if !setup.key_scheme.is_empty() {
        envs.insert("APP_KEY_SCHEME".into(), setup.key_scheme.clone());
    }

    let (mut rx, child) = app
        .shell()
        .sidecar("foxschema-sidecar")
        .map_err(|e| e.to_string())?
        .arg(server_js.to_string_lossy().to_string())
        .envs(envs)
        .spawn()
        .map_err(|e| e.to_string())?;

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

    *state.child.lock().unwrap() = Some(child);

    // Publish api_base only once the port is actually accepting connections —
    // otherwise the frontend's very first requests race the Node process
    // starting up (esbuild/driver requires can take several seconds).
    wait_for_port_ready(port, Duration::from_secs(30));
    *state.api_base.lock().unwrap() = api_base.clone();
    Ok(api_base)
}

/// Frontend calls this to learn where the Node sidecar is listening. Empty until
/// setup completes and the sidecar is spawned.
#[tauri::command]
fn get_api_base(state: State<AppState>) -> String {
    state.api_base.lock().unwrap().clone()
}

fn log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("foxschema.log"))
}

/// Path to the app's log file (see the `tauri_plugin_log` setup in `run()`), so
/// the frontend can show/copy it — e.g. from the setup screen when a user is
/// stuck before ever reaching a working app to look at.
#[tauri::command]
fn get_log_path(app: AppHandle) -> Result<String, String> {
    Ok(log_file_path(&app)?.to_string_lossy().to_string())
}

/// Reveal the log file in Finder/Explorer/the file manager. Calls the opener
/// crate's function directly rather than registering it as a plugin — this is
/// the only opener action the app exposes, and it's driven entirely by a path
/// we compute ourselves, never anything from the frontend, so there's no need
/// for the plugin's own (broader) permission surface.
#[tauri::command]
fn reveal_log_file(app: AppHandle) -> Result<(), String> {
    let path = log_file_path(&app)?;
    // reveal_item_in_dir requires the target to exist; fall back to the
    // containing folder if no line has been logged yet.
    let target = if path.exists() { path } else { path.parent().map(Path::to_path_buf).unwrap_or(path) };
    tauri_plugin_opener::reveal_item_in_dir(target).map_err(|e| e.to_string())
}

/// Truncate the log file so old noise doesn't obscure a fresh repro. Truncates
/// in place (rather than deleting) since `tauri_plugin_log` holds its own
/// write handle open for the process's lifetime — deleting the file out from
/// under it could leave future writes going to a now-unlinked inode.
#[tauri::command]
fn clear_log_file(app: AppHandle) -> Result<(), String> {
    let path = log_file_path(&app)?;
    if path.exists() {
        fs::File::create(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Native "save as" dialog for choosing the SQLite database location. Async so
/// it runs off the main thread (the blocking dialog would otherwise deadlock).
#[tauri::command]
async fn pick_db_location(app: AppHandle, default_dir: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut builder = app
        .dialog()
        .file()
        .set_title("Choose database location")
        .add_filter("SQLite database", &["db", "sqlite"])
        .set_file_name("foxschema.db");
    if let Some(dir) = default_dir {
        if let Some(parent) = std::path::PathBuf::from(dir).parent() {
            builder = builder.set_directory(parent);
        }
    }
    builder
        .blocking_save_file()
        .and_then(|fp| fp.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

/// Current first-run state — the frontend shows the setup screen until complete.
#[tauri::command]
fn get_setup_state(state: State<AppState>) -> SetupState {
    let api_base = state.api_base.lock().unwrap().clone();
    build_setup_state(state.inner(), &api_base)
}

/// Finish first-run setup: bind/create the keychain DEK for `email`, persist the
/// (non-secret) config, then spawn the sidecar. Migrates a pre-keychain install
/// by importing its on-disk key (kept as scheme v1 so existing data decrypts).
#[tauri::command]
async fn complete_setup(
    app: AppHandle,
    state: State<'_, AppState>,
    email: String,
    engine: Option<String>,
    db_path: Option<String>,
    db_url: Option<String>,
) -> Result<SetupState, String> {
    let email_norm = email.trim().to_lowercase();
    if !email_norm.contains('@') || email_norm.contains(char::is_whitespace) {
        return Err("A valid email is required.".into());
    }

    let engine = engine.unwrap_or_else(|| "sqlite".into());
    let db_url = db_url.unwrap_or_default().trim().to_string();
    if matches!(engine.as_str(), "postgres" | "mysql") && db_url.is_empty() {
        return Err("A connection string is required for Postgres/MySQL.".into());
    }
    if !matches!(engine.as_str(), "sqlite" | "postgres" | "mysql") {
        return Err(format!("Unsupported database engine \"{engine}\"."));
    }

    let resolved_db = db_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| state.default_db_path.clone());

    // Refuse a SQLite DB copied from another machine before touching anything
    // else (encryption key, setup.json) — see enforce_install_binding.
    enforce_install_binding(&app, &engine, &resolved_db).await?;

    let legacy_key = state.data_dir.join("encryption.key");
    let (dek, scheme) = if let Some(existing) = keychain_get(&email_norm) {
        // Already provisioned for this email — reuse it (keep recorded scheme).
        let scheme = {
            let s = state.setup.lock().unwrap();
            if s.key_scheme.is_empty() {
                "v2".to_string()
            } else {
                s.key_scheme.clone()
            }
        };
        (existing, scheme)
    } else if let Ok(file_key) = fs::read_to_string(&legacy_key) {
        // Migrate: import the on-disk key into the keychain, keep scheme v1 so
        // already-encrypted credentials still decrypt, then delete the file.
        let trimmed = file_key.trim().to_string();
        let dek = if trimmed.len() == 64 {
            trimmed
        } else {
            random_key_hex()
        };
        keychain_set(&email_norm, &dek)?;
        let _ = fs::remove_file(&legacy_key);
        (dek, "v1".to_string())
    } else {
        // Fresh install → new random DEK, email-bound (v2).
        let dek = random_key_hex();
        keychain_set(&email_norm, &dek)?;
        (dek, "v2".to_string())
    };

    let info = SetupInfo {
        setup_complete: true,
        email: email_norm,
        db_engine: engine,
        db_path: resolved_db,
        db_url,
        key_scheme: scheme,
    };
    write_setup(&state.data_dir, &info)?;
    *state.setup.lock().unwrap() = info;

    let api_base = spawn_sidecar(&app, state.inner(), &dek)?;
    Ok(build_setup_state(state.inner(), &api_base))
}

/// Switch the app's metadata database engine/location after setup (from
/// Settings → Database). Rewrites setup.json and respawns the sidecar on the new
/// engine; the frontend reloads against the returned api_base. The encryption
/// key and bound email are unchanged.
#[tauri::command]
async fn update_db_config(
    app: AppHandle,
    state: State<'_, AppState>,
    engine: String,
    db_path: Option<String>,
    db_url: Option<String>,
) -> Result<SetupState, String> {
    if !matches!(engine.as_str(), "sqlite" | "postgres" | "mysql") {
        return Err(format!("Unsupported database engine \"{engine}\"."));
    }
    let db_url = db_url.unwrap_or_default().trim().to_string();
    if matches!(engine.as_str(), "postgres" | "mysql") && db_url.is_empty() {
        return Err("A connection string is required for Postgres/MySQL.".into());
    }

    let email = state.setup.lock().unwrap().email.clone();
    if email.is_empty() {
        return Err("Setup is not complete.".into());
    }
    let dek = keychain_get(&email).ok_or("Encryption key not found in keychain.")?;

    let resolved_db = db_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| state.default_db_path.clone());

    // Refuse a SQLite DB copied from another machine before switching to it.
    enforce_install_binding(&app, &engine, &resolved_db).await?;

    let info = {
        let mut s = state.setup.lock().unwrap();
        s.db_engine = engine;
        s.db_path = resolved_db;
        s.db_url = db_url;
        s.clone()
    };
    write_setup(&state.data_dir, &info)?;

    let api_base = spawn_sidecar(&app, state.inner(), &dek)?;
    Ok(build_setup_state(state.inner(), &api_base))
}

/// Rebind the encryption key to a new email — from Settings, any time after
/// setup (which defaults to a placeholder email so first-run needs no input).
/// Re-stores the SAME key material under the new email's keychain account —
/// the DEK itself never changes, so already-encrypted data keeps decrypting —
/// then best-effort removes the old account. No sidecar respawn: the running
/// process already holds the DEK in memory and nothing about the metadata DB
/// changes.
#[tauri::command]
async fn update_email(state: State<'_, AppState>, email: String) -> Result<SetupState, String> {
    let email_norm = email.trim().to_lowercase();
    if !email_norm.contains('@') || email_norm.contains(char::is_whitespace) {
        return Err("A valid email is required.".into());
    }

    let old_email = state.setup.lock().unwrap().email.clone();
    if old_email.is_empty() {
        return Err("Setup is not complete.".into());
    }
    if email_norm == old_email {
        let api_base = state.api_base.lock().unwrap().clone();
        return Ok(build_setup_state(state.inner(), &api_base));
    }

    let dek = keychain_get(&old_email).ok_or("Encryption key not found in keychain.")?;
    keychain_set(&email_norm, &dek)?;

    let info = {
        let mut s = state.setup.lock().unwrap();
        s.email = email_norm.clone();
        s.key_scheme = "v2".to_string();
        s.clone()
    };
    write_setup(&state.data_dir, &info)?;

    if let Ok(entry) = keyring::Entry::new(KEY_SERVICE, &old_email) {
        let _ = entry.delete_credential();
    }

    let api_base = state.api_base.lock().unwrap().clone();
    Ok(build_setup_state(state.inner(), &api_base))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Always on (not just debug builds) — a release build with no logging
            // at all left users with nothing to share when something like the
            // sidecar failing to start (e.g. under Gatekeeper) went wrong. Writes
            // to the OS log dir (see `get_log_path`) plus stdout when run from a
            // terminal.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::LogDir { file_name: Some("foxschema".into()) },
                    ))
                    .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout))
                    .build(),
            )?;

            // Per-install state lives in the OS app-data dir.
            let data_dir = app.path().app_data_dir().expect("app data dir");
            fs::create_dir_all(&data_dir).ok();
            let default_db_path = data_dir.join("foxschema.db").to_string_lossy().to_string();
            let info = read_setup(&data_dir);

            app.manage(AppState {
                data_dir: data_dir.clone(),
                default_db_path,
                setup: Mutex::new(info.clone()),
                api_base: Mutex::new(String::new()),
                child: Mutex::new(None),
            });

            // If already set up, resolve the key from the keychain and launch the
            // sidecar. If the key is missing (e.g. the DB folder was copied to a
            // new machine), fall back to the setup screen — the copied data stays
            // undecryptable, which is the point.
            if info.setup_complete {
                if let Some(dek) = keychain_get(&info.email) {
                    let state = app.state::<AppState>();
                    if let Err(e) = spawn_sidecar(&app.handle(), state.inner(), &dek) {
                        log::error!("failed to spawn sidecar: {e}");
                    }
                } else {
                    log::warn!(
                        "setup marked complete but no key in keychain for {} — showing setup",
                        info.email
                    );
                    let state = app.state::<AppState>();
                    state.setup.lock().unwrap().setup_complete = false;
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_api_base,
            get_setup_state,
            complete_setup,
            update_db_config,
            update_email,
            pick_db_location,
            get_log_path,
            reveal_log_file,
            clear_log_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Make sure the sidecar dies with the app.
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Some(child) = state.child.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
