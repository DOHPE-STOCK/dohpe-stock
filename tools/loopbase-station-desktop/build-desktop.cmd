@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set ORIGINAL_DIR=%CD%
set STAGING_ROOT=%PUBLIC%\LoopbaseBuild
set STAGING_DIR=%STAGING_ROOT%\loopbase-station-desktop-%RANDOM%-%RANDOM%-%RANDOM%
set npm_config_cache=%STAGING_ROOT%\npm-cache
set APP_VERSION=
for /F "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do (
  set APP_VERSION=%%V
)
if "%APP_VERSION%"=="" (
  echo Could not read desktop package version from package.json.
  exit /b 1
)

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
  if exist "%STAGING_ROOT%" rmdir /S /Q "%STAGING_ROOT%"
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
  robocopy "%ORIGINAL_DIR%" "%STAGING_DIR%" /E /XD .build dist src-tauri\target /XF package-lock.json >nul
  if errorlevel 8 exit /b %errorlevel%
  if not exist "%STAGING_DIR%\src-tauri\icons\icon.ico" (
    if not exist "%STAGING_DIR%\src-tauri\icons" mkdir "%STAGING_DIR%\src-tauri\icons"
    copy /Y "%ORIGINAL_DIR%\src-tauri\icons\icon.ico" "%STAGING_DIR%\src-tauri\icons\icon.ico" >nul
    if errorlevel 1 exit /b %errorlevel%
  )
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
set NSIS_DIR=%ORIGINAL_DIR%\src-tauri\target\release\bundle\nsis
set SETUP_FILE=
for /F "usebackq delims=" %%F in (`powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%NSIS_DIR%' -Filter 'Loopbase Station Agent_%APP_VERSION%_x64-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do (
  set SETUP_FILE=%%F
)
if not "%SETUP_FILE%"=="" (
  copy /Y "%SETUP_FILE%" "%RELEASE_DIR%\Loopbase-Station-Agent-Setup.exe"
  if errorlevel 1 exit /b %errorlevel%
  echo Desktop installer copied to:
  echo %RELEASE_DIR%\Loopbase-Station-Agent-Setup.exe
  exit /b 0
)
echo.
echo Could not find desktop setup installer for version %APP_VERSION%.
echo Expected:
echo %NSIS_DIR%\Loopbase Station Agent_%APP_VERSION%_x64-setup.exe
echo Refusing to publish a stale installer.
exit /b 1
