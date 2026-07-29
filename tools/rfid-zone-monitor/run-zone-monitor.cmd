@echo off
setlocal
cd /d "%~dp0"

set PYTHON_EXE=python
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
)

if not exist config.local.json copy config.example.json config.local.json
"%PYTHON_EXE%" rfid_zone_monitor.py --config config.local.json
