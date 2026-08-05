@echo off
setlocal
cd /d "%~dp0"

set ORIGINAL_DIR=%CD%
set STAGING_ROOT=C:\LoopbaseBuild
set STAGING_DIR=%STAGING_ROOT%\loopbase-station-desktop

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

if /I not "%CD%"=="%STAGING_DIR%" (
  if not exist "%STAGING_ROOT%" mkdir "%STAGING_ROOT%"
  if exist "%STAGING_DIR%" rmdir /S /Q "%STAGING_DIR%"
  mkdir "%STAGING_DIR%"
  robocopy "%ORIGINAL_DIR%" "%STAGING_DIR%" /E /XD node_modules dist src-tauri\target /XF package-lock.json >nul
  if errorlevel 8 exit /b %errorlevel%
  copy /Y "%ORIGINAL_DIR%\package-lock.json" "%STAGING_DIR%\package-lock.json" >nul 2>nul
  cd /d "%STAGING_DIR%"
)

call npm install
if errorlevel 1 exit /b %errorlevel%

call npm run build
if errorlevel 1 exit /b %errorlevel%

if /I "%CD%"=="%STAGING_DIR%" (
  if exist "%ORIGINAL_DIR%\src-tauri\target" rmdir /S /Q "%ORIGINAL_DIR%\src-tauri\target"
  robocopy "%STAGING_DIR%\src-tauri\target" "%ORIGINAL_DIR%\src-tauri\target" /E >nul
  if errorlevel 8 exit /b %errorlevel%
  echo.
  echo Tauri build copied back to:
  echo %ORIGINAL_DIR%\src-tauri\target
)
