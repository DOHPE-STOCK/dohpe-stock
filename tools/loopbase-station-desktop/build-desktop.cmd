@echo off
setlocal
cd /d "%~dp0"

if not exist "..\loopbase-station-agent\dist\Loopbase Station Agent.exe" (
  echo Build the Python station agent first:
  echo ..\loopbase-station-agent\build-release.cmd
  exit /b 1
)

where rustc >nul 2>nul
if errorlevel 1 (
  echo Rust is required to build the Tauri Windows app.
  echo Install Rust from https://rustup.rs then open a new PowerShell and run this again.
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Cargo is required to build the Tauri Windows app.
  echo Install Rust from https://rustup.rs then open a new PowerShell and run this again.
  exit /b 1
)

copy /Y "..\loopbase-station-agent\dist\Loopbase Station Agent.exe" ".\src-tauri\Loopbase Station Agent.exe"
if errorlevel 1 exit /b %errorlevel%

npm install
if errorlevel 1 exit /b %errorlevel%

npm run build
