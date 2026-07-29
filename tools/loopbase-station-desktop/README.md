# Loopbase Station Desktop

Tauri wrapper for the Loopbase Station Agent.

The Python station agent remains the hardware service layer. This Tauri app gives it a proper Windows application window instead of asking staff to open a browser tab.

## Sections

- Remote Printer
- Photography Stations
- File Watcher
- RFID Reader / Writer
- RFID Zone Monitor
- Updates

## Build

Install prerequisites once on the build PC:

- Node.js
- Rust
- Microsoft WebView2 runtime
- Tauri prerequisites for Windows

Then run:

```powershell
cd "tools\loopbase-station-desktop"
npm install
npm run build
```

The app expects the Python agent executable to be copied beside the Tauri app as:

```text
Loopbase Station Agent.exe
```

During local development, it can also launch the repo script from `tools\loopbase-station-agent\loopbase_station_agent.py`.
