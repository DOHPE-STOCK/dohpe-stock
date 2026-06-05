@echo off
setlocal
cd /d "%~dp0"

set "BUNDLED_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if exist "%BUNDLED_PY%" (
  set "PYTHON_EXE=%BUNDLED_PY%"
) else (
  set "PYTHON_EXE=python"
)

echo Installing Fuzetec Python dependency using:
echo %PYTHON_EXE%
echo.

"%PYTHON_EXE%" -m pip install -r requirements.txt

echo.
echo Done. If installation failed because of the package source, run:
echo "%PYTHON_EXE%" -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple uhfReaderApi
pause
