@echo off
setlocal
cd /d "%~dp0"

set ORIGINAL_DIR=%CD%
set STAGING_ROOT=C:\LoopbaseBuild
set STAGING_DIR=%STAGING_ROOT%\loopbase-station-desktop

call "..\loopbase-station-agent\build-release.cmd"
if errorlevel 1 exit /b %errorlevel%

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

set RELEASE_DIR=%ORIGINAL_DIR%\..\..\public\downloads\loopbase-station-agent
if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"
set SETUP_FILE=
for %%F in ("%ORIGINAL_DIR%\src-tauri\target\release\bundle\nsis\Loopbase Station Agent_*_x64-setup.exe") do set SETUP_FILE=%%~fF
if not "%SETUP_FILE%"=="" (
  copy /Y "%SETUP_FILE%" "%RELEASE_DIR%\Loopbase-Station-Agent-Setup.exe"
  if errorlevel 1 exit /b %errorlevel%
  echo Desktop installer copied to:
  echo %RELEASE_DIR%\Loopbase-Station-Agent-Setup.exe
)
