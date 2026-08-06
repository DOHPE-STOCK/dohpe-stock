@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set ORIGINAL_DIR=%CD%
set STAGING_ROOT=C:\LoopbaseBuild
set STAGING_DIR=%STAGING_ROOT%\loopbase-station-desktop-%RANDOM%
set npm_config_cache=%STAGING_ROOT%\npm-cache

if exist "..\loopbase-station-agent\dist\Loopbase Station Agent.exe" (
  echo Reusing existing Loopbase Station Agent helper EXE.
) else if exist "..\..\public\downloads\loopbase-station-agent\Loopbase-Station-Agent.exe" (
  if not exist "..\loopbase-station-agent\dist" mkdir "..\loopbase-station-agent\dist"
  copy /Y "..\..\public\downloads\loopbase-station-agent\Loopbase-Station-Agent.exe" "..\loopbase-station-agent\dist\Loopbase Station Agent.exe"
  if errorlevel 1 exit /b %errorlevel%
) else (
  call "..\loopbase-station-agent\build-release.cmd"
  if errorlevel 1 exit /b %errorlevel%
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
  if errorlevel 1 (
    echo.
    echo Could not create %STAGING_ROOT%.
    echo Run this build from a normal PowerShell outside Codex, or remove old locked files in %STAGING_ROOT%.
    exit /b %errorlevel%
  )
  mkdir "%STAGING_DIR%"
  if errorlevel 1 (
    echo.
    echo Could not create %STAGING_DIR%.
    echo Close any running Loopbase Station Agent windows and rerun this from a normal PowerShell.
    exit /b %errorlevel%
  )
  robocopy "%ORIGINAL_DIR%" "%STAGING_DIR%" /E /XD dist src-tauri\target /XF package-lock.json >nul
  if errorlevel 8 exit /b %errorlevel%
  copy /Y "%ORIGINAL_DIR%\package-lock.json" "%STAGING_DIR%\package-lock.json" >nul 2>nul
  cd /d "%STAGING_DIR%"
)

if exist "node_modules\.bin\tauri.cmd" (
  echo Reusing existing desktop Node dependencies.
) else (
  call npm install --cache "%npm_config_cache%" --no-audit --no-fund
  if errorlevel 1 exit /b %errorlevel%
)

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
