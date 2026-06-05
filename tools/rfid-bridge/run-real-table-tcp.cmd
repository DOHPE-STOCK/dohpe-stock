@echo off
setlocal
cd /d "%~dp0"

set "BUNDLED_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if exist "%BUNDLED_PY%" (
  set "PYTHON_EXE=%BUNDLED_PY%"
) else (
  set "PYTHON_EXE=python"
)

set "READER_HOST=192.168.1.168"
set "READER_PORT=8160"
set "BRIDGE_PORT=8765"

echo Starting StockMaster RFID bridge for real Fuzetec table.
echo Reader: http://%READER_HOST%:%READER_PORT%
echo Bridge: http://127.0.0.1:%BRIDGE_PORT%
echo.
echo Keep this window open while using Processing ^> Receiving.
echo.

"%PYTHON_EXE%" rfid_bridge.py --mode tcp --reader-host %READER_HOST% --reader-port %READER_PORT% --listen-port %BRIDGE_PORT%

echo.
echo RFID bridge stopped.
pause
