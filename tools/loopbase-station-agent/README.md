# Loopbase Station Agent

Local Windows companion for Loopbase station hardware.

It is the local hardware service layer for the Tauri desktop app. It can still be
opened directly in a browser for debugging.

## Current Modules

- Photo ingest worker launcher and setup link
- RFID bridge launcher for mock, TCP, or serial reader modes
- RFID zone monitor launcher for threshold/doorway RUX2X readers
- Remote Printer module for local Windows printers, ZPL labels and A4/document jobs
- Remote print polling so Loopbase users can print to this PC from another PC/location
- Config editor saved to `config.local.json`

## Run During Development

Install dependencies on a station PC:

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\loopbase-station-agent"
.\install-station-deps.cmd
```

Run the local agent:

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\loopbase-station-agent"
.\run-agent.cmd
```

Open:

```text
http://127.0.0.1:8790
```

## Build EXE

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\loopbase-station-agent"
.\build-exe.cmd
```

The output will be:

```text
dist\Loopbase Station Agent.exe
```

## Notes

- The Tauri desktop wrapper lives in `tools/loopbase-station-desktop`.
- Remote printing works like a virtual printer relay: Loopbase queues jobs, this agent polls, prints locally, and reports success or failure.
- Windows RAW/ZPL and A4 shell printing need `pywin32`; network printer mode sends ZPL to TCP port `9100`.
- The RFID table bridge is for receiving tags on a table. The RFID zone monitor is separate and is for continuous doorway/exit monitoring with antenna-side direction inference.
