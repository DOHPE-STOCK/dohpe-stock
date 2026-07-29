# Loopbase Station Agent

Local Windows companion for Loopbase station hardware.

It is intentionally a small local web app first, so it can be packaged as an EXE later without changing the workflows.

## Current Modules

- Photo ingest worker launcher and setup link
- RFID bridge launcher for mock, TCP, or serial reader modes
- RFID zone monitor launcher for threshold/doorway RUX2X readers
- ZPL printer test panel for Windows printer names or network Zebra-compatible printers
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

- For early testing, the EXE still launches the same Python worker scripts behind the scenes.
- For SaaS clients, this can become an auto-updating signed Windows installer.
- Printer support is first-pass ZPL. Windows RAW spooler requires `pywin32`; network printer mode sends ZPL to TCP port `9100`.
- The RFID table bridge is for receiving tags on a table. The RFID zone monitor is separate and is for continuous doorway/exit monitoring with antenna-side direction inference.
