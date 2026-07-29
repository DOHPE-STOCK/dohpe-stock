@echo off
setlocal
cd /d "%~dp0"

if not exist config.local.json (
  copy config.example.json config.local.json >nul
)

set PYTHON_EXE=python
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
)

"%PYTHON_EXE%" loopbase_station_agent.py --config config.local.json
