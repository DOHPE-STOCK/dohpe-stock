@echo off
setlocal
cd /d "%~dp0"

set PYTHON_EXE=python
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
)

echo Installing Loopbase Station Agent dependencies...
"%PYTHON_EXE%" -m pip install --upgrade pip
"%PYTHON_EXE%" -m pip install -r requirements.txt

echo.
echo Installing photo processing dependencies...
"%PYTHON_EXE%" -m pip install -r "..\photo-ingest-worker\requirements-processing.txt"
"%PYTHON_EXE%" -m pip install "rembg[cpu]"

echo.
echo Installing optional Windows raw printer support...
"%PYTHON_EXE%" -m pip install pywin32

echo.
echo RFID vendor SDK is optional. Install it only on the RFID table PC:
echo "%PYTHON_EXE%" -m pip install -r "..\rfid-bridge\requirements.txt"
echo.
echo Done.
