#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};

struct AgentProcess(Mutex<Option<Child>>);

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

fn spawn_agent(app_handle: &tauri::AppHandle, state: State<AgentProcess>) {
    let mut process_guard = state.0.lock().expect("agent process lock");
    if process_guard.is_some() {
        return;
    }

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
            .arg("config.local.json")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if let Ok(child) = command.spawn() {
            *process_guard = Some(child);
            return;
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AgentProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AgentProcess>();
            spawn_agent(&handle, state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<AgentProcess>();
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(child) = guard.as_mut() {
                        let _ = child.kill();
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Loopbase Station Agent");
}
