@echo off
setlocal
cd /d "%~dp0"

set PYTHON_EXE=python
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  set PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
)

"%PYTHON_EXE%" -m PyInstaller --version >nul 2>nul
if errorlevel 1 (
  "%PYTHON_EXE%" -m pip install -r requirements.txt
  if errorlevel 1 exit /b %errorlevel%
)

"%PYTHON_EXE%" -m PyInstaller ^
  --name "Loopbase Station Agent" ^
  --onefile ^
  --noconsole ^
  --clean ^
  --hidden-import argparse ^
  --hidden-import hashlib ^
  --hidden-import html ^
  --hidden-import json ^
  --hidden-import mimetypes ^
  --hidden-import os ^
  --hidden-import signal ^
  --hidden-import sqlite3 ^
  --hidden-import _sqlite3 ^
  --hidden-import subprocess ^
  --hidden-import sys ^
  --hidden-import time ^
  --hidden-import uuid ^
  --hidden-import dataclasses ^
  --hidden-import pathlib ^
  --hidden-import http.server ^
  --hidden-import socketserver ^
  --hidden-import urllib.parse ^
  --hidden-import urllib.request ^
  --hidden-import urllib.error ^
  --add-data "..\photo-ingest-worker\photo_ingest_worker.py;photo-ingest-worker" ^
  --add-data "..\rfid-bridge\rfid_bridge.py;rfid-bridge" ^
  --add-data "..\rfid-zone-monitor\rfid_zone_monitor.py;rfid-zone-monitor" ^
  loopbase_station_agent.py
if errorlevel 1 exit /b %errorlevel%

echo.
echo Built EXE:
echo %CD%\dist\Loopbase Station Agent.exe
