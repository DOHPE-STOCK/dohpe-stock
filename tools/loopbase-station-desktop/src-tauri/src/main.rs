#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const INSTANCE_PORT: u16 = 8791;

struct AgentProcess(Mutex<Option<Child>>);

fn sanitize_version(version: &str) -> String {
    let safe: String = version
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_'))
        .collect();

    if safe.is_empty() {
        "latest".to_string()
    } else {
        safe
    }
}

fn quote_powershell_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn local_agent_ready() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 8790));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    if stream
        .write_all(b"GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut response = [0_u8; 128];
    match stream.read(&mut response) {
        Ok(size) if size > 0 => String::from_utf8_lossy(&response[..size]).contains("200 OK"),
        _ => false,
    }
}

fn local_agent_port_open() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 8790));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

#[cfg(target_os = "windows")]
fn kill_helper_processes() {
    let _ = Command::new("taskkill")
        .args(["/IM", "Loopbase Station Agent.exe", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(target_os = "windows"))]
fn kill_helper_processes() {}

fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn stop_agent(app_handle: &tauri::AppHandle) {
    let state = app_handle.state::<AgentProcess>();
    if let Ok(mut guard) = state.0.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
        }
        *guard = None;
    };

    kill_helper_processes();
}

fn claim_single_instance(app: &mut tauri::App) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], INSTANCE_PORT));
    match TcpListener::bind(address) {
        Ok(listener) => {
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    if stream.is_ok() {
                        show_main_window(&app_handle);
                    }
                }
            });
            true
        }
        Err(_) => {
            if let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) {
                let _ = stream.write_all(b"show");
            }
            false
        }
    }
}

fn candidate_agent_paths(app_handle: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("Loopbase Station Agent.exe"));
            paths.push(dir.join("resources").join("Loopbase Station Agent.exe"));
        }
    }

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        paths.push(resource_dir.join("Loopbase Station Agent.exe"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join("..").join("loopbase-station-agent").join("dist").join("Loopbase Station Agent.exe"));
        paths.push(cwd.join("..").join("loopbase-station-agent").join("loopbase_station_agent.py"));
    }

    paths
}

fn agent_config_path(app_handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(config_dir) = app_handle.path().app_config_dir() {
        let _ = fs::create_dir_all(&config_dir);
        return config_dir.join("config.local.json");
    }

    PathBuf::from("config.local.json")
}

fn spawn_agent(app_handle: &tauri::AppHandle, state: State<'_, AgentProcess>) {
    let _ = start_agent_with_diagnostics(app_handle, state);
}

fn start_agent_with_diagnostics(
    app_handle: &tauri::AppHandle,
    state: State<'_, AgentProcess>,
) -> Result<String, String> {
    let mut process_guard = state.0.lock().expect("agent process lock");
    if process_guard.is_some() {
        return Ok("Station helper process is already tracked by the desktop app.".to_string());
    }

    if local_agent_ready() {
        return Ok("Station helper is already running and /status responded.".to_string());
    }

    if local_agent_port_open() {
        kill_helper_processes();
        std::thread::sleep(Duration::from_millis(700));
    }

    let config_path = agent_config_path(app_handle);
    let config_dir = config_path
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    let mut attempts: Vec<String> = Vec::new();
    for path in candidate_agent_paths(app_handle) {
        if !path.exists() {
            attempts.push(format!("not found: {}", path.display()));
            continue;
        }

        let mut command = if path.extension().and_then(|value| value.to_str()) == Some("py") {
            let mut cmd = Command::new("python");
            cmd.arg(&path);
            cmd
        } else {
            Command::new(&path)
        };

        command
            .arg("--config")
            .arg(&config_path)
            .current_dir(&config_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(child) => {
                let spawned_path = path.display().to_string();
                *process_guard = Some(child);
                drop(process_guard);

                for _ in 0..12 {
                    if local_agent_ready() {
                        return Ok(format!("Started station helper from {spawned_path}."));
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }

                return Err(format!(
                    "Started helper from {spawned_path}, but /status did not respond within 6 seconds."
                ));
            }
            Err(error) => attempts.push(format!("failed: {} ({error})", path.display())),
        }
    }

    Err(format!(
        "Could not start station helper. Attempts: {}",
        attempts.join(" | ")
    ))
}

#[tauri::command]
fn station_agent_status() -> bool {
    local_agent_ready()
}

#[tauri::command]
fn ensure_station_agent(
    app_handle: tauri::AppHandle,
    state: State<'_, AgentProcess>,
) -> Result<String, String> {
    start_agent_with_diagnostics(&app_handle, state)
}

#[tauri::command]
fn install_station_agent_update(
    app_handle: tauri::AppHandle,
    download_url: String,
    version: String,
    expected_size_bytes: Option<u64>,
) -> Result<String, String> {
    if download_url.trim().is_empty() {
        return Err("The update did not include a download URL.".to_string());
    }

    stop_agent(&app_handle);

    let safe_version = sanitize_version(&version);
    let base_dir = app_handle
        .path()
        .app_local_data_dir()
        .or_else(|_| app_handle.path().app_cache_dir())
        .map_err(|error| format!("Could not find a writable update folder: {error}"))?
        .join("updates")
        .join(format!("update-{safe_version}-{}", std::process::id()));

    fs::create_dir_all(&base_dir)
        .map_err(|error| format!("Could not create update folder: {error}"))?;

    let installer_path = base_dir.join(format!("Loopbase-Station-Agent-Setup-{safe_version}.exe"));
    let ps_script = format!(
        "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri {url:?} -OutFile {out:?};",
        url = download_url,
        out = installer_path.display().to_string()
    );

    let download_status = Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps_script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| format!("Could not start update download: {error}"))?;

    if !download_status.success() {
        return Err("The update download failed before the installer could start.".to_string());
    }

    let metadata = fs::metadata(&installer_path)
        .map_err(|error| format!("The downloaded installer could not be read: {error}"))?;
    let downloaded_size = metadata.len();
    if downloaded_size < 1024 * 1024 {
        return Err(format!(
            "The downloaded file was only {downloaded_size} bytes, so Loopbase did not run it. The update URL probably returned an error page instead of the installer."
        ));
    }
    if let Some(expected_size) = expected_size_bytes {
        if expected_size > 0 && downloaded_size != expected_size {
            return Err(format!(
                "The downloaded installer size did not match the release manifest. Expected {expected_size} bytes, got {downloaded_size} bytes."
            ));
        }
    }

    let mut magic = [0_u8; 2];
    let mut installer_file = fs::File::open(&installer_path)
        .map_err(|error| format!("The downloaded installer could not be opened: {error}"))?;
    installer_file
        .read_exact(&mut magic)
        .map_err(|error| format!("The downloaded installer could not be checked: {error}"))?;
    if magic != [b'M', b'Z'] {
        return Err("The downloaded file is not a Windows installer. The update URL returned the wrong content.".to_string());
    }

    let update_script = base_dir.join("run-loopbase-update.ps1");
    let current_pid = std::process::id();
    let app_exe = std::env::current_exe()
        .map_err(|error| format!("Could not resolve current app path: {error}"))?;
    let script = format!(
        "$ErrorActionPreference = 'SilentlyContinue'\r\n\
Start-Sleep -Seconds 2\r\n\
Stop-Process -Id {current_pid} -Force\r\n\
Get-Process -Name 'loopbase-station-desktop' | Stop-Process -Force\r\n\
Get-Process -Name 'Loopbase Station Agent' | Stop-Process -Force\r\n\
$installer = {installer}\r\n\
$appExe = {app_exe}\r\n\
Start-Process -FilePath $installer -ArgumentList '/S' -Wait\r\n\
Start-Sleep -Seconds 2\r\n\
if (Test-Path $appExe) {{ Start-Process -FilePath $appExe }}\r\n",
        installer = quote_powershell_string(&installer_path.display().to_string()),
        app_exe = quote_powershell_string(&app_exe.display().to_string())
    );
    let mut handle = fs::File::create(&update_script)
        .map_err(|error| format!("Could not create update launcher: {error}"))?;
    handle
        .write_all(script.as_bytes())
        .map_err(|error| format!("Could not write update launcher: {error}"))?;

    Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
            &update_script.display().to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("Could not start update installer: {error}"))?;

    Ok(format!(
        "Loopbase Station Agent {safe_version} update started. Loopbase will close, update, and reopen automatically."
    ))
}

#[tauri::command]
fn select_windows_folder(title: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let safe_title = title.replace('\'', "''");
        let script = format!(
            "$shell = New-Object -ComObject Shell.Application; \
             $folder = $shell.BrowseForFolder(0, '{safe_title}', 0, 0); \
             if ($folder -ne $null) {{ $folder.Self.Path }}"
        );
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-STA", "-Command", &script])
            .stdin(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("Could not open folder selector: {error}"))?;
        if !output.status.success() {
            return Err("Folder selector was closed or failed to open.".to_string());
        }
        let selected = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if selected.is_empty() {
            return Err("No folder selected.".to_string());
        }
        return Ok(selected);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = title;
        Err("Folder selection is currently supported on Windows station PCs.".to_string())
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open_dashboard", "Open Loopbase Station Agent", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit_loopbase", "Quit Loopbase Station Agent", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("loopbase-station-agent")
        .icon(tauri::include_image!("icons/icon.png"))
        .tooltip("Loopbase Station Agent is running")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "open_dashboard" => show_main_window(app_handle),
            "quit_loopbase" => {
                stop_agent(app_handle);
                app_handle.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(AgentProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            station_agent_status,
            ensure_station_agent,
            install_station_agent_update,
            select_windows_folder
        ])
        .setup(|app| {
            if !claim_single_instance(app) {
                app.handle().exit(0);
                return Ok(());
            }
            setup_tray(app)?;
            let handle = app.handle().clone();
            let state = app.state::<AgentProcess>();
            spawn_agent(&handle, state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Loopbase Station Agent");
}
