#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct AgentProcess(Mutex<Option<Child>>);

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

fn spawn_agent(app_handle: &tauri::AppHandle, state: State<AgentProcess>) {
    let mut process_guard = state.0.lock().expect("agent process lock");
    if process_guard.is_some() {
        return;
    }

    let config_path = agent_config_path(app_handle);
    let config_dir = config_path
        .parent()
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    for path in candidate_agent_paths(app_handle) {
        if !path.exists() {
            continue;
        }

        let mut command = if path.extension().and_then(|value| value.to_str()) == Some("py") {
            let mut cmd = Command::new("python");
            cmd.arg(path);
            cmd
        } else {
            Command::new(path)
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

        if let Ok(child) = command.spawn() {
            *process_guard = Some(child);
            return;
        }
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open_dashboard", "Open Station Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit_loopbase", "Quit Loopbase Station Agent", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    TrayIconBuilder::with_id("loopbase-station-agent")
        .icon(tauri::include_image!("../icons/icon.png"))
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
        .setup(|app| {
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
