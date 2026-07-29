@echo off
setlocal
cd /d "%~dp0"

call "%~dp0build-exe.cmd"
if errorlevel 1 exit /b %errorlevel%

set RELEASE_DIR=%~dp0..\..\public\downloads\loopbase-station-agent
if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"

copy /Y "%~dp0dist\Loopbase Station Agent.exe" "%RELEASE_DIR%\Loopbase-Station-Agent.exe"
if errorlevel 1 exit /b %errorlevel%

echo.
echo Release copied to:
echo %RELEASE_DIR%\Loopbase-Station-Agent.exe
