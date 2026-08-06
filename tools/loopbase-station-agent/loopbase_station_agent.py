from __future__ import annotations

import argparse
import base64
import html
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


AGENT_VERSION_NUMBER = "0.2.1"
AGENT_VERSION = f"loopbase-station-agent/{AGENT_VERSION_NUMBER}"


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def bool_value(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return text(value).lower() in {"1", "true", "yes", "on"}


def int_value(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def float_value(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def resource_dir() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(getattr(sys, "_MEIPASS"))
    return app_dir()


def repo_tools_dir() -> Path:
    return app_dir().parent


def default_python() -> str:
    return sys.executable


def default_config() -> dict[str, Any]:
    return {
        "app_url": "https://loopbase.io",
        "agent_host": "127.0.0.1",
        "agent_port": 8790,
        "update_manifest_url": "",
        "update_check_interval_seconds": 3600,
        "python_path": "",
        "photo_worker": {
            "enabled": True,
            "script_path": "../photo-ingest-worker/photo_ingest_worker.py",
            "config_path": "photo-worker.local.json",
            "setup_port": 8780,
        },
        "rfid_bridge": {
            "enabled": False,
            "script_path": "../rfid-bridge/rfid_bridge.py",
            "listen_host": "127.0.0.1",
            "listen_port": 8765,
            "mode": "mock",
            "reader_host": "192.168.1.168",
            "reader_port": 8160,
            "serial_port": "COM7",
            "baud": 115200,
            "antenna": 1,
        },
        "rfid_zone_monitor": {
            "enabled": False,
            "script_path": "../rfid-zone-monitor/rfid_zone_monitor.py",
            "config_path": "rfid-zone-monitor.local.json",
            "mode": "mock",
            "zone_token": "",
            "listen_host": "127.0.0.1",
            "listen_port": 8775,
            "reader_host": "192.168.0.200",
            "reader_port": 200,
            "q_value": 5,
            "algorithm": 2,
            "read_tid": True,
            "apply_global_power_on_start": False,
            "global_power_dbm": 24,
            "apply_antenna_settings_on_start": False,
            "antenna_ports": [
                {"antenna": 1, "enabled": True, "side": "outside", "power_dbm": 24, "inventory_count": 4},
                {"antenna": 2, "enabled": True, "side": "inside", "power_dbm": 24, "inventory_count": 4},
                {"antenna": 3, "enabled": False, "side": "outside", "power_dbm": 18, "inventory_count": 2},
                {"antenna": 4, "enabled": False, "side": "inside", "power_dbm": 18, "inventory_count": 2},
            ],
            "dedupe_window_seconds": 1.2,
            "present_ttl_seconds": 5,
            "room_stale_alert_seconds": 180,
            "alarm_output_enabled": False,
            "alarm_gpo_port": 1,
            "alarm_active_level": 1,
            "alarm_pulse_seconds": 3,
            "alarm_trigger_on_app_alarm": True,
            "exit_warning_enabled": False,
            "exit_warning_gpo_port": 2,
            "exit_warning_active_level": 1,
            "exit_warning_pulse_seconds": 0.4,
            "exit_warning_min_rssi": -48,
            "exit_warning_min_read_count": 4,
        },
        "printer": {
            "enabled": True,
            "mode": "windows",
            "windows_printer_name": "",
            "remote_enabled": True,
            "remote_poll_enabled": False,
            "station_token": "",
            "poll_interval_seconds": 5,
            "allowed_printers": [],
            "network_host": "",
            "network_port": 9100,
            "default_label_width_mm": 60,
            "default_label_height_mm": 40,
        },
    }


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return default_config()
    with path.open("r", encoding="utf-8-sig") as handle:
        raw = json.load(handle)
    return deep_merge(default_config(), raw if isinstance(raw, dict) else {})


def version_parts(value: Any) -> list[int]:
    parts: list[int] = []
    for part in text(value).replace("-", ".").split("."):
        number = ""
        for char in part:
            if char.isdigit():
                number += char
            else:
                break
        if number:
            parts.append(int(number))
    return parts or [0]


def version_is_newer(candidate: Any, current: Any) -> bool:
    left = version_parts(candidate)
    right = version_parts(current)
    width = max(len(left), len(right))
    left.extend([0] * (width - len(left)))
    right.extend([0] * (width - len(right)))
    return left > right


def absolute_app_url(app_url: Any, maybe_url: Any) -> str:
    value = text(maybe_url)
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        return value
    base = text(app_url).rstrip("/")
    if not base:
        return value
    return f"{base}/{value.lstrip('/')}"


def save_config(path: Path, config: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")


def resolve_path(value: str, base: Path | None = None) -> Path:
    path = Path(text(value))
    if path.is_absolute():
        return path
    return ((base or app_dir()) / path).resolve()


def resolve_cli_path(value: str) -> Path:
    path = Path(text(value))
    if path.is_absolute():
        return path
    cwd_path = (Path.cwd() / path).resolve()
    if cwd_path.exists() or path.parent != Path("."):
        return cwd_path
    return (app_dir() / path).resolve()


def make_photo_worker_config(agent_config: dict[str, Any], config_path: Path) -> dict[str, Any]:
    current = {}
    if config_path.exists():
        try:
            with config_path.open("r", encoding="utf-8-sig") as handle:
                current = json.load(handle)
        except Exception:
            current = {}
    if not isinstance(current, dict):
        current = {}
    current.setdefault("app_url", agent_config.get("app_url") or "https://loopbase.io")
    current.setdefault("database_path", "photo_ingest_worker.sqlite3")
    current.setdefault("scan_interval_seconds", 2)
    current.setdefault("stable_seconds", 3)
    current.setdefault("max_upload_attempts", 20)
    current.setdefault("enable_processing_jobs", True)
    current.setdefault("sources", [])
    return current


def make_rfid_zone_config(agent_config: dict[str, Any], config_path: Path) -> dict[str, Any]:
    current = {}
    if config_path.exists():
        try:
            with config_path.open("r", encoding="utf-8-sig") as handle:
                current = json.load(handle)
        except Exception:
            current = {}
    if not isinstance(current, dict):
        current = {}
    zone = agent_config.get("rfid_zone_monitor") or {}
    current["mode"] = zone.get("mode") or "mock"
    current["app_url"] = agent_config.get("app_url") or "https://loopbase.io"
    current["zone_token"] = zone.get("zone_token") or ""
    current["listen_host"] = zone.get("listen_host") or "127.0.0.1"
    current["listen_port"] = int_value(zone.get("listen_port"), 8775)
    current["reader_host"] = zone.get("reader_host") or "192.168.0.200"
    current["reader_port"] = int_value(zone.get("reader_port"), 200)
    current["q_value"] = int_value(zone.get("q_value"), 5)
    current["algorithm"] = int_value(zone.get("algorithm"), 2)
    current["read_tid"] = bool_value(zone.get("read_tid"))
    current["apply_global_power_on_start"] = bool_value(zone.get("apply_global_power_on_start"))
    current["global_power_dbm"] = float_value(zone.get("global_power_dbm"), 24)
    current["apply_antenna_settings_on_start"] = bool_value(zone.get("apply_antenna_settings_on_start"))
    current["antenna_quantity"] = 4
    current["antenna_auto_polling"] = True
    current["antenna_ports"] = zone.get("antenna_ports") or default_config()["rfid_zone_monitor"]["antenna_ports"]
    current["dedupe_window_seconds"] = zone.get("dedupe_window_seconds") or 1.2
    current["present_ttl_seconds"] = zone.get("present_ttl_seconds") or 5
    current["room_stale_alert_seconds"] = zone.get("room_stale_alert_seconds") or 180
    current["alarm_output_enabled"] = bool_value(zone.get("alarm_output_enabled"))
    current["alarm_gpo_port"] = int_value(zone.get("alarm_gpo_port"), 1)
    current["alarm_active_level"] = int_value(zone.get("alarm_active_level"), 1)
    current["alarm_pulse_seconds"] = float_value(zone.get("alarm_pulse_seconds"), 3)
    current["alarm_trigger_on_app_alarm"] = bool_value(zone.get("alarm_trigger_on_app_alarm"))
    current["exit_warning_enabled"] = bool_value(zone.get("exit_warning_enabled"))
    current["exit_warning_gpo_port"] = int_value(zone.get("exit_warning_gpo_port"), 2)
    current["exit_warning_active_level"] = int_value(zone.get("exit_warning_active_level"), 1)
    current["exit_warning_pulse_seconds"] = float_value(zone.get("exit_warning_pulse_seconds"), 0.4)
    current["exit_warning_min_rssi"] = int_value(zone.get("exit_warning_min_rssi"), -48)
    current["exit_warning_min_read_count"] = int_value(zone.get("exit_warning_min_read_count"), 4)
    return current


@dataclass
class ManagedProcess:
    name: str
    command: list[str]
    cwd: Path
    process: subprocess.Popen[str] | None = None
    started_at: float | None = None
    last_output: list[str] = field(default_factory=list)
    last_error: str = ""
    _reader_thread: threading.Thread | None = None

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self) -> None:
        if self.running():
            return
        self.last_error = ""
        self.process = subprocess.Popen(
            self.command,
            cwd=str(self.cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self.started_at = time.time()
        self._reader_thread = threading.Thread(target=self._read_output, daemon=True)
        self._reader_thread.start()

    def _read_output(self) -> None:
        if not self.process or not self.process.stdout:
            return
        try:
            for line in self.process.stdout:
                cleaned = line.rstrip()
                self.last_output.append(cleaned)
                self.last_output = self.last_output[-120:]
        except Exception as exc:
            self.last_error = str(exc)

    def stop(self) -> None:
        if not self.process:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None

    def status(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "running": self.running(),
            "pid": self.process.pid if self.running() and self.process else None,
            "started_at": self.started_at,
            "last_error": self.last_error,
            "last_output": self.last_output[-20:],
        }


class StationAgent:
    def __init__(self, config_path: Path) -> None:
        self.config_path = config_path
        self.config = load_config(config_path)
        self.processes: dict[str, ManagedProcess] = {}
        self.lock = threading.Lock()
        self.update_cache: dict[str, Any] = {}
        self.update_checked_at = 0.0
        self.update_error = ""
        self.remote_print_reports: list[dict[str, Any]] = []
        self.stop_event = threading.Event()

    def reload(self) -> None:
        self.config = load_config(self.config_path)

    def write_quick_setup(self, fields: dict[str, str]) -> None:
        cfg = deep_merge(default_config(), self.config)
        app_url = text(fields.get("app_url")) or text(cfg.get("app_url")) or "https://loopbase.io"
        station_token = text(fields.get("station_token"))

        cfg["app_url"] = app_url.rstrip("/")
        printer = cfg["printer"]
        printer["enabled"] = True
        printer["remote_enabled"] = True
        printer["remote_poll_enabled"] = bool(station_token)
        printer["station_token"] = station_token or printer.get("station_token") or ""

        self.config = cfg
        save_config(self.config_path, cfg)
        self.ensure_photo_config()
        self.ensure_rfid_zone_config()

    def write_config_from_form(self, fields: dict[str, str]) -> None:
        cfg = deep_merge(default_config(), self.config)
        cfg["app_url"] = fields.get("app_url", cfg["app_url"]).rstrip("/")
        cfg["update_manifest_url"] = fields.get("update_manifest_url", cfg.get("update_manifest_url") or "")
        cfg["update_check_interval_seconds"] = int_value(
            fields.get("update_check_interval_seconds"),
            int(cfg.get("update_check_interval_seconds") or 3600),
        )
        cfg["python_path"] = fields.get("python_path", cfg.get("python_path") or "")

        photo = cfg["photo_worker"]
        photo["enabled"] = bool_value(fields.get("photo_enabled"))
        photo["config_path"] = fields.get("photo_config_path", photo["config_path"])
        photo["setup_port"] = int_value(fields.get("photo_setup_port"), int(photo["setup_port"]))

        rfid = cfg["rfid_bridge"]
        rfid["enabled"] = bool_value(fields.get("rfid_enabled"))
        rfid["mode"] = fields.get("rfid_mode", rfid["mode"])
        rfid["listen_host"] = fields.get("rfid_listen_host", rfid["listen_host"])
        rfid["listen_port"] = int_value(fields.get("rfid_listen_port"), int(rfid["listen_port"]))
        rfid["reader_host"] = fields.get("rfid_reader_host", rfid["reader_host"])
        rfid["reader_port"] = int_value(fields.get("rfid_reader_port"), int(rfid["reader_port"]))
        rfid["serial_port"] = fields.get("rfid_serial_port", rfid["serial_port"])
        rfid["baud"] = int_value(fields.get("rfid_baud"), int(rfid["baud"]))
        rfid["antenna"] = int_value(fields.get("rfid_antenna"), int(rfid["antenna"]))

        zone = cfg["rfid_zone_monitor"]
        zone["enabled"] = bool_value(fields.get("rfid_zone_enabled"))
        zone["config_path"] = fields.get("rfid_zone_config_path", zone["config_path"])
        zone["mode"] = fields.get("rfid_zone_mode", zone["mode"])
        zone["zone_token"] = fields.get("rfid_zone_token", zone.get("zone_token") or "")
        zone["listen_host"] = fields.get("rfid_zone_listen_host", zone["listen_host"])
        zone["listen_port"] = int_value(fields.get("rfid_zone_listen_port"), int(zone["listen_port"]))
        zone["reader_host"] = fields.get("rfid_zone_reader_host", zone["reader_host"])
        zone["reader_port"] = int_value(fields.get("rfid_zone_reader_port"), int(zone["reader_port"]))
        zone["q_value"] = int_value(fields.get("rfid_zone_q_value"), int(zone["q_value"]))
        zone["algorithm"] = int_value(fields.get("rfid_zone_algorithm"), int(zone["algorithm"]))
        zone["read_tid"] = bool_value(fields.get("rfid_zone_read_tid"))
        zone["apply_global_power_on_start"] = bool_value(fields.get("rfid_zone_apply_global_power"))
        zone["global_power_dbm"] = float_value(fields.get("rfid_zone_global_power_dbm"), float(zone.get("global_power_dbm") or 24))
        zone["apply_antenna_settings_on_start"] = bool_value(fields.get("rfid_zone_apply_antenna_settings"))
        zone["dedupe_window_seconds"] = float_value(fields.get("rfid_zone_dedupe_seconds"), float(zone.get("dedupe_window_seconds") or 1.2))
        zone["present_ttl_seconds"] = float_value(fields.get("rfid_zone_present_ttl_seconds"), float(zone.get("present_ttl_seconds") or 5))
        zone["room_stale_alert_seconds"] = float_value(fields.get("rfid_zone_stale_seconds"), float(zone.get("room_stale_alert_seconds") or 180))
        zone["alarm_output_enabled"] = bool_value(fields.get("rfid_zone_alarm_output_enabled"))
        zone["alarm_gpo_port"] = int_value(fields.get("rfid_zone_alarm_gpo_port"), int(zone.get("alarm_gpo_port") or 1))
        zone["alarm_active_level"] = int_value(fields.get("rfid_zone_alarm_active_level"), int(zone.get("alarm_active_level") or 1))
        zone["alarm_pulse_seconds"] = float_value(fields.get("rfid_zone_alarm_pulse_seconds"), float(zone.get("alarm_pulse_seconds") or 3))
        zone["alarm_trigger_on_app_alarm"] = bool_value(fields.get("rfid_zone_alarm_trigger_on_app_alarm"))
        zone["exit_warning_enabled"] = bool_value(fields.get("rfid_zone_exit_warning_enabled"))
        zone["exit_warning_gpo_port"] = int_value(fields.get("rfid_zone_exit_warning_gpo_port"), int(zone.get("exit_warning_gpo_port") or 2))
        zone["exit_warning_active_level"] = int_value(fields.get("rfid_zone_exit_warning_active_level"), int(zone.get("exit_warning_active_level") or 1))
        zone["exit_warning_pulse_seconds"] = float_value(fields.get("rfid_zone_exit_warning_pulse_seconds"), float(zone.get("exit_warning_pulse_seconds") or 0.4))
        zone["exit_warning_min_rssi"] = int_value(fields.get("rfid_zone_exit_warning_min_rssi"), int(zone.get("exit_warning_min_rssi") or -48))
        zone["exit_warning_min_read_count"] = int_value(fields.get("rfid_zone_exit_warning_min_read_count"), int(zone.get("exit_warning_min_read_count") or 4))
        antenna_ports_raw = fields.get("rfid_zone_antenna_ports_json", "")
        if antenna_ports_raw:
            parsed_ports = json.loads(antenna_ports_raw)
            if not isinstance(parsed_ports, list):
                raise RuntimeError("RFID zone antenna settings must be a JSON array.")
            zone["antenna_ports"] = parsed_ports

        printer = cfg["printer"]
        printer["enabled"] = bool_value(fields.get("printer_enabled"))
        printer["remote_enabled"] = bool_value(fields.get("printer_remote_enabled"))
        printer["remote_poll_enabled"] = bool_value(fields.get("printer_remote_poll_enabled"))
        printer["station_token"] = fields.get("printer_station_token", printer.get("station_token") or "")
        printer["poll_interval_seconds"] = int_value(
            fields.get("printer_poll_interval_seconds"),
            int(printer.get("poll_interval_seconds") or 5),
        )
        printer["mode"] = fields.get("printer_mode", printer["mode"])
        printer["windows_printer_name"] = fields.get("windows_printer_name", printer["windows_printer_name"])
        allowed_printers_raw = fields.get("allowed_printers_json", "")
        if allowed_printers_raw:
            parsed_printers = json.loads(allowed_printers_raw)
            if not isinstance(parsed_printers, list):
                raise RuntimeError("Allowed remote printers must be a JSON array.")
            printer["allowed_printers"] = [text(name) for name in parsed_printers if text(name)]
        printer["network_host"] = fields.get("network_host", printer["network_host"])
        printer["network_port"] = int_value(fields.get("network_port"), int(printer["network_port"]))
        printer["default_label_width_mm"] = int_value(fields.get("label_width_mm"), int(printer["default_label_width_mm"]))
        printer["default_label_height_mm"] = int_value(fields.get("label_height_mm"), int(printer["default_label_height_mm"]))

        self.config = cfg
        save_config(self.config_path, cfg)
        self.ensure_photo_config()
        self.ensure_rfid_zone_config()

    def ensure_photo_config(self) -> Path:
        photo = self.config["photo_worker"]
        config_path = resolve_path(photo["config_path"], self.config_path.parent)
        data = make_photo_worker_config(self.config, config_path)
        save_config(config_path, data)
        return config_path

    def ensure_rfid_zone_config(self) -> Path:
        zone = self.config["rfid_zone_monitor"]
        config_path = resolve_path(zone["config_path"], self.config_path.parent)
        data = make_rfid_zone_config(self.config, config_path)
        for key in [
            "mode",
            "app_url",
            "zone_token",
            "listen_host",
            "listen_port",
            "reader_host",
            "reader_port",
            "q_value",
            "algorithm",
            "read_tid",
            "apply_antenna_settings_on_start",
            "antenna_ports",
            "dedupe_window_seconds",
            "present_ttl_seconds",
            "room_stale_alert_seconds",
        ]:
            if key in zone:
                data[key] = zone[key]
        save_config(config_path, data)
        return config_path

    def python_exe(self) -> str:
        configured = text(self.config.get("python_path"))
        return configured or default_python()

    def photo_worker_process(self) -> ManagedProcess:
        photo = self.config["photo_worker"]
        script_path = resolve_path(photo["script_path"], app_dir())
        if not script_path.exists():
            bundled = resource_dir() / "photo-ingest-worker" / "photo_ingest_worker.py"
            script_path = bundled if bundled.exists() else script_path
        config_path = self.ensure_photo_config()
        return ManagedProcess(
            name="Photo Ingest Worker",
            command=[self.python_exe(), str(script_path), "--config", str(config_path)],
            cwd=script_path.parent if script_path.exists() else app_dir(),
        )

    def photo_setup_process(self) -> ManagedProcess:
        photo = self.config["photo_worker"]
        script_path = resolve_path(photo["script_path"], app_dir())
        if not script_path.exists():
            bundled = resource_dir() / "photo-ingest-worker" / "photo_ingest_worker.py"
            script_path = bundled if bundled.exists() else script_path
        config_path = self.ensure_photo_config()
        return ManagedProcess(
            name="Photo Setup UI",
            command=[
                self.python_exe(),
                str(script_path),
                "--setup",
                "--config",
                str(config_path),
                "--setup-port",
                str(photo.get("setup_port") or 8780),
            ],
            cwd=script_path.parent if script_path.exists() else app_dir(),
        )

    def rfid_process(self) -> ManagedProcess:
        rfid = self.config["rfid_bridge"]
        script_path = resolve_path(rfid["script_path"], app_dir())
        if not script_path.exists():
            bundled = resource_dir() / "rfid-bridge" / "rfid_bridge.py"
            script_path = bundled if bundled.exists() else script_path
        command = [
            self.python_exe(),
            str(script_path),
            "--listen-host",
            str(rfid["listen_host"]),
            "--listen-port",
            str(rfid["listen_port"]),
            "--mode",
            str(rfid["mode"]),
            "--reader-host",
            str(rfid["reader_host"]),
            "--reader-port",
            str(rfid["reader_port"]),
            "--serial-port",
            str(rfid["serial_port"]),
            "--baud",
            str(rfid["baud"]),
            "--antenna",
            str(rfid["antenna"]),
        ]
        return ManagedProcess(
            name="RFID Bridge",
            command=command,
            cwd=script_path.parent if script_path.exists() else app_dir(),
        )

    def rfid_zone_process(self) -> ManagedProcess:
        zone = self.config["rfid_zone_monitor"]
        script_path = resolve_path(zone["script_path"], app_dir())
        if not script_path.exists():
            bundled = resource_dir() / "rfid-zone-monitor" / "rfid_zone_monitor.py"
            script_path = bundled if bundled.exists() else script_path
        config_path = self.ensure_rfid_zone_config()
        command = [
            self.python_exe(),
            str(script_path),
            "--config",
            str(config_path),
            "--mode",
            str(zone["mode"]),
            "--listen-host",
            str(zone["listen_host"]),
            "--listen-port",
            str(zone["listen_port"]),
            "--reader-host",
            str(zone["reader_host"]),
            "--reader-port",
            str(zone["reader_port"]),
        ]
        return ManagedProcess(
            name="RFID Zone Monitor",
            command=command,
            cwd=script_path.parent if script_path.exists() else app_dir(),
        )

    def start_service(self, service: str) -> None:
        with self.lock:
            if service == "photo":
                process = self.processes.get(service) or self.photo_worker_process()
            elif service == "photo_setup":
                process = self.processes.get(service) or self.photo_setup_process()
            elif service == "rfid":
                process = self.processes.get(service) or self.rfid_process()
            elif service == "rfid_zone":
                process = self.processes.get(service) or self.rfid_zone_process()
            else:
                raise RuntimeError("Unknown service.")
            self.processes[service] = process
            process.start()

    def stop_service(self, service: str) -> None:
        with self.lock:
            process = self.processes.get(service)
            if process:
                process.stop()

    def status(self) -> dict[str, Any]:
        return {
            "version": AGENT_VERSION,
            "version_number": AGENT_VERSION_NUMBER,
            "config_path": str(self.config_path),
            "app_url": self.config.get("app_url"),
            "update": self.check_for_updates(force=False),
            "printers": list_windows_printers(),
            "processes": {key: process.status() for key, process in self.processes.items()},
        }

    def update_manifest_url(self) -> str:
        configured = text(self.config.get("update_manifest_url"))
        if configured:
            return absolute_app_url(self.config.get("app_url"), configured)
        return absolute_app_url(self.config.get("app_url"), "/api/station-agent/releases/latest")

    def check_for_updates(self, force: bool = False) -> dict[str, Any]:
        now = time.time()
        interval = int_value(self.config.get("update_check_interval_seconds"), 3600)
        if not force and self.update_cache and now - self.update_checked_at < max(60, interval):
            return self.update_cache

        manifest_url = self.update_manifest_url()
        payload: dict[str, Any] = {
            "ok": False,
            "available": False,
            "current_version": AGENT_VERSION_NUMBER,
            "manifest_url": manifest_url,
            "checked_at": int(now),
        }
        try:
            request = urllib.request.Request(
                manifest_url,
                headers={"Accept": "application/json", "User-Agent": AGENT_VERSION},
            )
            with urllib.request.urlopen(request, timeout=8) as response:
                body = response.read().decode("utf-8")
            manifest = json.loads(body)
            latest_version = text(manifest.get("version"))
            payload.update(manifest)
            payload.update(
                {
                    "ok": True,
                    "available": bool(latest_version and version_is_newer(latest_version, AGENT_VERSION_NUMBER)),
                    "current_version": AGENT_VERSION_NUMBER,
                    "version": latest_version or AGENT_VERSION_NUMBER,
                    "download_url": absolute_app_url(self.config.get("app_url"), manifest.get("download_url")),
                    "manifest_url": manifest_url,
                    "checked_at": int(now),
                }
            )
            self.update_error = ""
        except Exception as exc:
            self.update_error = str(exc)
            payload["message"] = f"Update check failed: {exc}"

        self.update_cache = payload
        self.update_checked_at = now
        return payload

    def download_and_start_update(self) -> Path:
        update = self.check_for_updates(force=True)
        if update.get("available") is not True:
            raise RuntimeError("No newer Station Agent update is available.")

        download_url = text(update.get("download_url"))
        version = text(update.get("version")) or "latest"
        if not download_url:
            raise RuntimeError("The update manifest did not include a download URL.")

        target = Path(tempfile.gettempdir()) / f"Loopbase-Station-Agent-Setup-{version}.exe"
        request = urllib.request.Request(download_url, headers={"User-Agent": AGENT_VERSION})
        with urllib.request.urlopen(request, timeout=90) as response:
            target.write_bytes(response.read())

        subprocess.Popen([str(target)], close_fds=True)

        def stop_soon() -> None:
            time.sleep(1.5)
            self.stop_event.set()
            self.stop_all()
            os._exit(0)

        threading.Thread(target=stop_soon, daemon=True).start()
        return target

    def stop_all(self) -> None:
        self.stop_event.set()
        with self.lock:
            for process in self.processes.values():
                process.stop()

    def drain_remote_print_reports(self) -> list[dict[str, Any]]:
        with self.lock:
            reports = list(self.remote_print_reports)
            self.remote_print_reports = []
        return reports

    def add_remote_print_report(self, report: dict[str, Any]) -> None:
        with self.lock:
            self.remote_print_reports.append(report)

    def remote_print_poll_payload(self) -> dict[str, Any]:
        return {
            "station_token": deep_merge(default_config(), self.config)["printer"].get("station_token") or "",
            "printers": list_windows_printers(),
            "services": {key: process.status() for key, process in self.processes.items()},
            "reports": self.drain_remote_print_reports(),
        }

    def poll_remote_print_jobs_once(self) -> None:
        printer = deep_merge(default_config(), self.config)["printer"]
        if not bool_value(printer.get("remote_enabled")) or not bool_value(printer.get("remote_poll_enabled")):
            return
        if not text(printer.get("station_token")):
            return

        url = absolute_app_url(self.config.get("app_url"), "/api/v1/station-print-jobs")
        payload = json.dumps(self.remote_print_poll_payload()).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": AGENT_VERSION},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
        result = json.loads(body or "{}")
        for job in result.get("jobs") or []:
            job_id = text(job.get("id"))
            if not job_id:
                continue
            try:
                handle_remote_print_job(
                    self,
                    {
                        "printer_name": job.get("printer_name"),
                        "job_type": job.get("job_type"),
                        "document_name": job.get("document_name"),
                        "filename": job.get("filename"),
                        "content_base64": job.get("content_base64"),
                        "content": job.get("content_text"),
                    },
                )
                self.add_remote_print_report({"id": job_id, "status": "printed"})
            except Exception as exc:
                self.add_remote_print_report({"id": job_id, "status": "failed", "error_message": str(exc)})

    def remote_print_poll_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.poll_remote_print_jobs_once()
            except Exception as exc:
                print(f"Remote print poll failed: {exc}")
            interval = int_value(deep_merge(default_config(), self.config)["printer"].get("poll_interval_seconds"), 5)
            self.stop_event.wait(max(2, interval))


def zpl_test_label(width_mm: int = 60, height_mm: int = 40) -> str:
    dots_w = int(width_mm * 8)
    dots_h = int(height_mm * 8)
    return f"""^XA
^PW{dots_w}
^LL{dots_h}
^CI28
^FO30,25^A0N,34,34^FDLoopbase^FS
^FO30,70^A0N,22,22^FDStation Agent Test^FS
^FO30,105^BY2,2,55^BCN,55,Y,N,N^FDLB-TEST-001^FS
^FO30,{dots_h - 55}^A0N,18,18^FDZPL OK - {time.strftime('%Y-%m-%d %H:%M')}^FS
^XZ
"""


def send_zpl_windows(printer_name: str, zpl: str) -> None:
    try:
        import win32print  # type: ignore
    except Exception as exc:
        raise RuntimeError("Windows RAW printing needs pywin32 installed: pip install pywin32") from exc

    handle = win32print.OpenPrinter(printer_name)
    try:
        job = win32print.StartDocPrinter(handle, 1, ("Loopbase ZPL Test", None, "RAW"))
        try:
            win32print.StartPagePrinter(handle)
            win32print.WritePrinter(handle, zpl.encode("utf-8"))
            win32print.EndPagePrinter(handle)
        finally:
            win32print.EndDocPrinter(handle)
    finally:
        win32print.ClosePrinter(handle)


def list_windows_printers() -> list[dict[str, Any]]:
    if os.name != "nt":
        return []
    try:
        import win32print  # type: ignore
    except Exception:
        return []

    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    printers = []
    try:
        default_name = ""
        try:
            default_name = win32print.GetDefaultPrinter()
        except Exception:
            default_name = ""
        for row in win32print.EnumPrinters(flags):
            name = text(row[2] if len(row) > 2 else "")
            if name:
                printers.append({"name": name, "default": name == default_name})
    except Exception:
        return []
    return sorted(printers, key=lambda item: (not item.get("default"), text(item.get("name")).lower()))


def printer_allowed(agent_config: dict[str, Any], printer_name: str) -> bool:
    printer = deep_merge(default_config(), agent_config)["printer"]
    if not bool_value(printer.get("remote_enabled")):
        return False
    allowed = [text(name) for name in printer.get("allowed_printers") or [] if text(name)]
    return not allowed or printer_name in allowed


def send_windows_raw(printer_name: str, payload: bytes, document_name: str = "Loopbase Remote Print") -> None:
    try:
        import win32print  # type: ignore
    except Exception as exc:
        raise RuntimeError("Windows RAW printing needs pywin32 installed: pip install pywin32") from exc

    handle = win32print.OpenPrinter(printer_name)
    try:
        job = win32print.StartDocPrinter(handle, 1, (document_name, None, "RAW"))
        try:
            win32print.StartPagePrinter(handle)
            win32print.WritePrinter(handle, payload)
            win32print.EndPagePrinter(handle)
        finally:
            win32print.EndDocPrinter(handle)
    finally:
        win32print.ClosePrinter(handle)


def print_file_windows(printer_name: str, filename: str, payload: bytes) -> Path:
    if os.name != "nt":
        raise RuntimeError("A4/document printing is currently supported on Windows station PCs.")
    suffix = Path(filename or "loopbase-print.pdf").suffix or ".pdf"
    temp_dir = Path(tempfile.gettempdir()) / "loopbase-station-agent-print-jobs"
    temp_dir.mkdir(parents=True, exist_ok=True)
    target = temp_dir / f"loopbase-{int(time.time() * 1000)}{suffix}"
    target.write_bytes(payload)

    try:
        import win32api  # type: ignore
        if printer_name:
            win32api.ShellExecute(0, "printto", str(target), f'"{printer_name}"', str(temp_dir), 0)
        else:
            win32api.ShellExecute(0, "print", str(target), None, str(temp_dir), 0)
    except Exception:
        if printer_name:
            raise RuntimeError("A4 printing to a named printer needs pywin32 installed and a default app that supports printto.")
        os.startfile(str(target), "print")  # type: ignore[attr-defined]
    return target


def handle_remote_print_job(agent: StationAgent, payload: dict[str, Any]) -> dict[str, Any]:
    printer_name = text(payload.get("printer_name")) or text(deep_merge(default_config(), agent.config)["printer"].get("windows_printer_name"))
    if not printer_name:
        raise RuntimeError("Remote print job needs a printer_name or default Windows printer in Station Agent settings.")
    if not printer_allowed(agent.config, printer_name):
        raise RuntimeError(f"Remote printing is not enabled for {printer_name}.")

    job_type = text(payload.get("job_type") or "file_base64")
    document_name = text(payload.get("document_name") or "Loopbase Remote Print")
    if job_type == "zpl":
        content = text(payload.get("content"))
        if not content:
            raise RuntimeError("ZPL print job is missing content.")
        send_windows_raw(printer_name, content.encode("utf-8"), document_name)
        return {"ok": True, "message": "ZPL print job sent.", "printer_name": printer_name}
    if job_type in {"raw_text", "raw_base64"}:
        if job_type == "raw_base64":
            raw = base64.b64decode(text(payload.get("content_base64")))
        else:
            raw = text(payload.get("content")).encode("utf-8")
        send_windows_raw(printer_name, raw, document_name)
        return {"ok": True, "message": "Raw print job sent.", "printer_name": printer_name}
    if job_type == "file_base64":
        raw = base64.b64decode(text(payload.get("content_base64")))
        saved_path = print_file_windows(printer_name, text(payload.get("filename") or document_name), raw)
        return {"ok": True, "message": "Document print job handed to Windows.", "printer_name": printer_name, "local_path": str(saved_path)}
    raise RuntimeError(f"Unsupported print job type: {job_type}.")


def send_zpl_network(host: str, port: int, zpl: str) -> None:
    if not host:
        raise RuntimeError("Network printer host is required.")
    with socket.create_connection((host, port), timeout=8) as conn:
        conn.sendall(zpl.encode("utf-8"))


def html_attr(value: Any) -> str:
    return html.escape(text(value), quote=True)


def checked(value: Any) -> str:
    return "checked" if bool_value(value) else ""


def selected(current: Any, value: str) -> str:
    return "selected" if text(current) == value else ""


def render_page(agent: StationAgent, message: str = "") -> bytes:
    cfg = deep_merge(default_config(), agent.config)
    photo = cfg["photo_worker"]
    rfid = cfg["rfid_bridge"]
    zone = cfg["rfid_zone_monitor"]
    printer = cfg["printer"]
    status = agent.status()
    printers = status.get("printers") or []
    allowed_printers_json = json.dumps(printer.get("allowed_printers") or [], indent=2)
    update = status.get("update") or {}
    update_available = update.get("available") is True
    update_download_url = text(update.get("download_url"))
    update_version = text(update.get("version"))
    update_message = text(update.get("message"))
    update_banner = ""
    if update_available:
        update_banner = f"""
        <div class="update-banner">
          <div>
            <p class="eyebrow">Update Available</p>
            <h2>Loopbase Station Agent {html.escape(update_version)} is ready</h2>
            <p class="muted">Current version: {html.escape(AGENT_VERSION_NUMBER)}.</p>
          </div>
          <form method="post" action="/update/install" onsubmit="return confirm('Are you sure? This will download the update and restart the software.')">
            <button>Update Now</button>
          </form>
          <a class="button secondary" href="{html_attr(update_download_url)}" target="_blank">Download Only</a>
        </div>
        """
    elif update_message:
        update_banner = f"""
        <div class="update-banner subtle">
          <div>
            <p class="eyebrow">Update Check</p>
            <p class="muted">{html.escape(update_message)}</p>
          </div>
        </div>
        """
    process_cards = []
    for key, label in [
        ("photo", "Photo Ingest"),
        ("photo_setup", "Photo Setup UI"),
        ("rfid", "RFID Bridge"),
        ("rfid_zone", "RFID Zone Monitor"),
    ]:
        row = status["processes"].get(key, {})
        running = row.get("running") is True
        output = "\n".join(row.get("last_output") or [])[-3000:]
        process_cards.append(
            f"""
            <article class="service">
              <div>
                <p class="eyebrow">{label}</p>
                <h3>{'Running' if running else 'Stopped'}</h3>
              </div>
              <span class="status {'ok' if running else 'idle'}">{'LIVE' if running else 'OFF'}</span>
              <pre>{html.escape(output or 'No output yet.')}</pre>
              <div class="actions">
                <form method="post" action="/service/start"><input type="hidden" name="service" value="{key}"><button>Start</button></form>
                <form method="post" action="/service/stop"><input type="hidden" name="service" value="{key}"><button class="secondary">Stop</button></form>
              </div>
            </article>
            """
        )

    setup_url = f"http://127.0.0.1:{int(photo.get('setup_port') or 8780)}"
    rfid_url = f"http://{html_attr(rfid.get('listen_host'))}:{int(rfid.get('listen_port') or 8765)}/status"
    rfid_zone_url = f"http://{html_attr(zone.get('listen_host'))}:{int(zone.get('listen_port') or 8775)}/"
    rfid_zone_antenna_json = json.dumps(zone.get("antenna_ports") or [], indent=2)
    module_cards = [
        ("remote-printer", "Remote Printer", "Print ZPL labels, A4 PDFs and local Windows printer jobs from any company PC."),
        ("photography", "Photography Stations", "Run photography sessions, phone pairing and station capture tools."),
        ("file-watcher", "File Watcher", "Watch camera, NAS or local folders and upload new session images."),
        ("rfid-reader", "RFID Reader / Writer", "Use table readers for receiving, TID capture and future tag writing."),
        ("rfid-zone", "RFID Zone Monitor", "Monitor exits, entrances, changing rooms and stock rooms with threshold readers."),
        ("updates", "Updates", "Check for newer Station Agent versions while the app is running."),
    ]
    module_grid = "".join(
        f"""
        <a class="module-card" href="#{html_attr(anchor)}">
          <span class="module-icon">{index}</span>
          <strong>{html.escape(title)}</strong>
          <small>{html.escape(description)}</small>
        </a>
        """
        for index, (anchor, title, description) in enumerate(module_cards, start=1)
    )
    printer_options = "".join(
        f"<option value=\"{html_attr(row.get('name'))}\" {selected(printer.get('windows_printer_name'), text(row.get('name')))}>{html.escape(text(row.get('name')))}{' (default)' if row.get('default') else ''}</option>"
        for row in printers
    )
    first_run_setup = ""
    if not text(printer.get("station_token")):
        first_run_setup = f"""
        <section class="setup-banner">
          <div>
            <p class="eyebrow">First Run Setup</p>
            <h2>Connect this PC to Loopbase</h2>
            <p class="muted">Enter station token for this device here.</p>
          </div>
          <form method="post" action="/setup/token" class="setup-form">
            <label>Loopbase URL<input name="app_url" value="{html_attr(cfg.get('app_url') or 'https://loopbase.io')}"></label>
            <label>Station token<input name="station_token" value="" placeholder="Paste station token"></label>
            <button>Connect Station</button>
          </form>
        </section>
        """
    body = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loopbase Station Agent</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #070a0d;
      --panel: #101418;
      --panel2: #151b20;
      --line: #26313a;
      --text: #f5f7f8;
      --muted: #9ca8b3;
      --green: #17a56b;
      --green2: #0f754e;
      --red: #b83a3a;
      --amber: #d39b2a;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top left, rgba(23,165,107,.16), transparent 34rem), var(--bg);
      color: var(--text);
    }}
    .shell {{ max-width: 1220px; margin: 0 auto; padding: 24px; }}
    header {{
      display: flex; align-items: flex-start; justify-content: space-between; gap: 18px;
      padding: 22px; border: 1px solid var(--line); border-radius: 18px; background: rgba(16,20,24,.92);
      box-shadow: 0 24px 60px rgba(0,0,0,.28);
    }}
    h1, h2, h3, p {{ margin: 0; }}
    h1 {{ font-size: 30px; letter-spacing: 0; }}
    h2 {{ font-size: 18px; margin-bottom: 12px; }}
    h3 {{ font-size: 18px; }}
    .eyebrow {{ color: #8ee6bd; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }}
    .muted {{ color: var(--muted); font-weight: 700; margin-top: 6px; }}
    .grid {{ display: grid; grid-template-columns: 1.08fr .92fr; gap: 16px; margin-top: 16px; }}
    .module-grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }}
    .module-card {{
      min-height: 150px; display: grid; align-content: start; gap: 9px; text-decoration: none; color: var(--text);
      border: 1px solid var(--line); border-radius: 18px; background: linear-gradient(145deg, rgba(21,27,32,.96), rgba(10,13,16,.96)); padding: 18px;
    }}
    .module-card:hover {{ border-color: #36956a; transform: translateY(-1px); }}
    .module-card strong {{ font-size: 18px; }}
    .module-card small {{ color: var(--muted); font-weight: 750; line-height: 1.4; }}
    .module-icon {{
      width: 38px; height: 38px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;
      background: #153d2b; color: #9cf0c7; font-weight: 950; border: 1px solid #276947;
    }}
    .panel, .service {{
      border: 1px solid var(--line); border-radius: 16px; background: rgba(16,20,24,.94); padding: 18px;
    }}
    .service {{ display: grid; grid-template-columns: 1fr auto; gap: 12px; }}
    .service pre {{
      grid-column: 1 / -1; margin: 0; min-height: 120px; max-height: 180px; overflow: auto;
      padding: 12px; border-radius: 10px; background: #06080a; border: 1px solid #202830;
      color: #b9c4cc; font-size: 12px; white-space: pre-wrap;
    }}
    .services {{ display: grid; gap: 12px; }}
    .status {{ align-self: start; border-radius: 999px; padding: 6px 10px; font-size: 11px; font-weight: 950; }}
    .status.ok {{ background: var(--green); color: white; }}
    .status.idle {{ background: #2a3138; color: #c5cbd1; }}
    .actions {{ grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; }}
    form {{ margin: 0; }}
    label {{ display: grid; gap: 6px; color: #cbd3d9; font-size: 12px; font-weight: 900; }}
    input, select, textarea {{
      width: 100%; min-height: 40px; border-radius: 10px; border: 1px solid #33404a;
      background: #070a0d; color: white; padding: 9px 11px; font: inherit; font-weight: 700;
    }}
    textarea {{ min-height: 190px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }}
    input[type="checkbox"] {{ width: auto; min-height: auto; }}
    .form-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }}
    .wide {{ grid-column: 1 / -1; }}
    .check {{ display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid #26313a; border-radius: 12px; padding: 10px 12px; background: #0c1014; }}
    button, .button {{
      border: 0; border-radius: 10px; background: var(--green); color: white; padding: 10px 14px;
      font-weight: 950; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center;
    }}
    button:hover, .button:hover {{ background: #1abc7b; }}
    button.secondary, .button.secondary {{ background: #273039; color: white; }}
    button.danger {{ background: var(--red); }}
    .message {{ margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: #123123; border: 1px solid #276947; color: #c8f6df; font-weight: 800; }}
    .update-banner {{
      margin-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 16px;
      border: 1px solid #2f7d58; border-radius: 16px; background: rgba(18,49,35,.92); padding: 16px 18px;
    }}
    .setup-banner {{
      margin-top: 14px; display: grid; grid-template-columns: 1fr minmax(320px, 480px); gap: 16px; align-items: end;
      border: 1px solid #2f7d58; border-radius: 16px; background: rgba(12,37,27,.94); padding: 18px;
    }}
    .setup-form {{ display: grid; grid-template-columns: 1fr; gap: 10px; }}
    .update-banner.subtle {{ border-color: #394652; background: rgba(16,20,24,.92); }}
    .top-actions {{ display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }}
    .section-stack {{ display: grid; gap: 16px; }}
    .printer-list {{ display: grid; gap: 6px; margin-top: 10px; color: #cbd3d9; font-size: 13px; font-weight: 800; }}
    @media (max-width: 900px) {{ .grid, .form-grid, .module-grid, .setup-banner {{ grid-template-columns: 1fr; }} header {{ flex-direction: column; }} }}
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <p class="eyebrow">Loopbase Station Agent</p>
        <h1>Local Hardware Control</h1>
        <p class="muted">Photo ingest, RFID table bridge, printer bridge and station setup from one local Windows app.</p>
      </div>
      <div class="top-actions">
        <a class="button secondary" href="{html_attr(cfg.get('app_url'))}" target="_blank">Open Loopbase</a>
        <a class="button secondary" href="{setup_url}" target="_blank">Photo Setup</a>
        <a class="button secondary" href="{rfid_url}" target="_blank">RFID Status</a>
        <a class="button secondary" href="{rfid_zone_url}" target="_blank">RFID Zone</a>
      </div>
    </header>
    {update_banner}
    {first_run_setup}
    {f'<div class="message">{html.escape(message)}</div>' if message else ''}
    <section class="module-grid">
      {module_grid}
    </section>
    <div class="grid">
      <section class="section-stack">
        <div class="panel" id="photography">
          <h2>Station Config</h2>
          <form method="post" action="/config/save">
            <div class="form-grid">
              <label class="wide">Loopbase URL<input name="app_url" value="{html_attr(cfg.get('app_url'))}"></label>
              <label class="wide">Update manifest URL<input name="update_manifest_url" value="{html_attr(cfg.get('update_manifest_url'))}" placeholder="Leave blank to use /api/station-agent/releases/latest"></label>
              <label>Update check interval seconds<input name="update_check_interval_seconds" value="{html_attr(cfg.get('update_check_interval_seconds'))}"></label>
              <label class="wide">Python path override<input name="python_path" value="{html_attr(cfg.get('python_path'))}" placeholder="Leave blank to use bundled/current Python"></label>
              <label class="check" id="file-watcher">Photo ingest / file watcher enabled<input type="checkbox" name="photo_enabled" {checked(photo.get('enabled'))}></label>
              <label>Photo worker config<input name="photo_config_path" value="{html_attr(photo.get('config_path'))}"></label>
              <label>Photo setup port<input name="photo_setup_port" value="{html_attr(photo.get('setup_port'))}"></label>
              <label class="check" id="rfid-reader">RFID reader / writer enabled<input type="checkbox" name="rfid_enabled" {checked(rfid.get('enabled'))}></label>
              <label>RFID mode
                <select name="rfid_mode">
                  <option value="mock" {selected(rfid.get('mode'), 'mock')}>Mock</option>
                  <option value="tcp" {selected(rfid.get('mode'), 'tcp')}>TCP reader</option>
                  <option value="serial" {selected(rfid.get('mode'), 'serial')}>Serial reader</option>
                </select>
              </label>
              <label>Bridge host<input name="rfid_listen_host" value="{html_attr(rfid.get('listen_host'))}"></label>
              <label>Bridge port<input name="rfid_listen_port" value="{html_attr(rfid.get('listen_port'))}"></label>
              <label>Reader IP<input name="rfid_reader_host" value="{html_attr(rfid.get('reader_host'))}"></label>
              <label>Reader port<input name="rfid_reader_port" value="{html_attr(rfid.get('reader_port'))}"></label>
              <label>Serial port<input name="rfid_serial_port" value="{html_attr(rfid.get('serial_port'))}"></label>
              <label>Baud<input name="rfid_baud" value="{html_attr(rfid.get('baud'))}"></label>
              <label>Antenna<input name="rfid_antenna" value="{html_attr(rfid.get('antenna'))}"></label>
              <label class="check wide" id="rfid-zone">RFID threshold/zone monitor enabled<input type="checkbox" name="rfid_zone_enabled" {checked(zone.get('enabled'))}></label>
              <label>Zone config<input name="rfid_zone_config_path" value="{html_attr(zone.get('config_path'))}"></label>
              <label class="wide">Zone token<input name="rfid_zone_token" value="{html_attr(zone.get('zone_token'))}" placeholder="Paste the token generated in Loopbase RFID zone settings"></label>
              <label>Zone mode
                <select name="rfid_zone_mode">
                  <option value="mock" {selected(zone.get('mode'), 'mock')}>Mock</option>
                  <option value="tcp_command" {selected(zone.get('mode'), 'tcp_command')}>RUX2X TCP command</option>
                  <option value="tcp_stream_server" {selected(zone.get('mode'), 'tcp_stream_server')}>RUX2X polling stream server</option>
                </select>
              </label>
              <label>Zone UI host<input name="rfid_zone_listen_host" value="{html_attr(zone.get('listen_host'))}"></label>
              <label>Zone UI port<input name="rfid_zone_listen_port" value="{html_attr(zone.get('listen_port'))}"></label>
              <label>Zone reader IP<input name="rfid_zone_reader_host" value="{html_attr(zone.get('reader_host'))}"></label>
              <label>Zone reader port<input name="rfid_zone_reader_port" value="{html_attr(zone.get('reader_port'))}"></label>
              <label>Q value<input name="rfid_zone_q_value" value="{html_attr(zone.get('q_value'))}"></label>
              <label>Algorithm
                <select name="rfid_zone_algorithm">
                  <option value="0" {selected(zone.get('algorithm'), '0')}>0 - fast unique count</option>
                  <option value="1" {selected(zone.get('algorithm'), '1')}>1 - balanced</option>
                  <option value="2" {selected(zone.get('algorithm'), '2')}>2 - repeated read strength</option>
                </select>
              </label>
              <label class="check">Read TID as tag identity<input type="checkbox" name="rfid_zone_read_tid" {checked(zone.get('read_tid'))}></label>
              <label class="check">Apply global RF power on start<input type="checkbox" name="rfid_zone_apply_global_power" {checked(zone.get('apply_global_power_on_start'))}></label>
              <label>Global RF power dBm<input name="rfid_zone_global_power_dbm" value="{html_attr(zone.get('global_power_dbm'))}"></label>
              <label class="check">Apply antenna power/settings on start<input type="checkbox" name="rfid_zone_apply_antenna_settings" {checked(zone.get('apply_antenna_settings_on_start'))}></label>
              <label>Dedupe seconds<input name="rfid_zone_dedupe_seconds" value="{html_attr(zone.get('dedupe_window_seconds'))}"></label>
              <label>Present TTL seconds<input name="rfid_zone_present_ttl_seconds" value="{html_attr(zone.get('present_ttl_seconds'))}"></label>
              <label>Stale-inside alert seconds<input name="rfid_zone_stale_seconds" value="{html_attr(zone.get('room_stale_alert_seconds'))}"></label>
              <label class="check">Built-in alarm/light output enabled<input type="checkbox" name="rfid_zone_alarm_output_enabled" {checked(zone.get('alarm_output_enabled'))}></label>
              <label class="check">Trigger output from Loopbase alarm<input type="checkbox" name="rfid_zone_alarm_trigger_on_app_alarm" {checked(zone.get('alarm_trigger_on_app_alarm'))}></label>
              <label>Reader alarm output port<input name="rfid_zone_alarm_gpo_port" value="{html_attr(zone.get('alarm_gpo_port'))}"></label>
              <label>Alarm active level
                <select name="rfid_zone_alarm_active_level">
                  <option value="1" {selected(zone.get('alarm_active_level'), '1')}>High</option>
                  <option value="0" {selected(zone.get('alarm_active_level'), '0')}>Low</option>
                </select>
              </label>
              <label>Alarm pulse seconds<input name="rfid_zone_alarm_pulse_seconds" value="{html_attr(zone.get('alarm_pulse_seconds'))}"></label>
              <label class="check">Built-in exit-intent warning<input type="checkbox" name="rfid_zone_exit_warning_enabled" {checked(zone.get('exit_warning_enabled'))}></label>
              <label>Reader warning output port<input name="rfid_zone_exit_warning_gpo_port" value="{html_attr(zone.get('exit_warning_gpo_port'))}"></label>
              <label>Warning active level
                <select name="rfid_zone_exit_warning_active_level">
                  <option value="1" {selected(zone.get('exit_warning_active_level'), '1')}>High</option>
                  <option value="0" {selected(zone.get('exit_warning_active_level'), '0')}>Low</option>
                </select>
              </label>
              <label>Warning pulse seconds<input name="rfid_zone_exit_warning_pulse_seconds" value="{html_attr(zone.get('exit_warning_pulse_seconds'))}"></label>
              <label>Warning min RSSI<input name="rfid_zone_exit_warning_min_rssi" value="{html_attr(zone.get('exit_warning_min_rssi'))}"></label>
              <label>Warning min reads<input name="rfid_zone_exit_warning_min_read_count" value="{html_attr(zone.get('exit_warning_min_read_count'))}"></label>
              <label class="wide">Zone antenna settings JSON<textarea name="rfid_zone_antenna_ports_json">{html.escape(rfid_zone_antenna_json)}</textarea></label>
              <label class="check" id="remote-printer">Remote printer enabled<input type="checkbox" name="printer_enabled" {checked(printer.get('enabled'))}></label>
              <label class="check">Accept print jobs from Loopbase<input type="checkbox" name="printer_remote_enabled" {checked(printer.get('remote_enabled'))}></label>
              <label class="check">Poll Loopbase remote print queue<input type="checkbox" name="printer_remote_poll_enabled" {checked(printer.get('remote_poll_enabled'))}></label>
              <label class="wide">Station print token<input name="printer_station_token" value="{html_attr(printer.get('station_token'))}" placeholder="Paste the token from this device in Loopbase company settings"></label>
              <label>Poll interval seconds<input name="printer_poll_interval_seconds" value="{html_attr(printer.get('poll_interval_seconds'))}"></label>
              <label>Printer mode
                <select name="printer_mode">
                  <option value="windows" {selected(printer.get('mode'), 'windows')}>Windows printer</option>
                  <option value="network" {selected(printer.get('mode'), 'network')}>Network TCP/ZPL</option>
                </select>
              </label>
              <label>Default Windows printer
                <select name="windows_printer_name">
                  <option value="">Choose local printer</option>
                  {printer_options}
                </select>
              </label>
              <label class="wide">Allowed remote printers JSON<textarea name="allowed_printers_json">{html.escape(allowed_printers_json)}</textarea></label>
              <label>Network host<input name="network_host" value="{html_attr(printer.get('network_host'))}"></label>
              <label>Network port<input name="network_port" value="{html_attr(printer.get('network_port'))}"></label>
              <label>Label width mm<input name="label_width_mm" value="{html_attr(printer.get('default_label_width_mm'))}"></label>
              <label>Label height mm<input name="label_height_mm" value="{html_attr(printer.get('default_label_height_mm'))}"></label>
            </div>
            <p style="margin-top:12px"><button>Save Config</button></p>
          </form>
        </div>

        <div class="panel">
          <h2>Remote Printer</h2>
          <p class="muted">This PC can expose its connected Windows printers to Loopbase users in the same company. ZPL labels are sent raw; A4/PDF-style jobs are handed to Windows using the local default app for that file type.</p>
          <div class="printer-list">
            {''.join(f"<span>{'Default: ' if row.get('default') else ''}{html.escape(text(row.get('name')))}</span>" for row in printers) or '<span>No Windows printers detected. Install pywin32 and check Windows printer settings.</span>'}
          </div>
          <form method="post" action="/printer/test" style="margin-top:12px">
            <button>Print ZPL Test Label</button>
          </form>
        </div>

        <div class="panel" id="updates">
          <h2>Updates</h2>
          <p class="muted">Installed version: {html.escape(AGENT_VERSION_NUMBER)}. The agent checks Loopbase while this app is running and shows a download banner when a newer build is published.</p>
          <form method="post" action="/update/check" style="margin-top:12px">
            <button class="secondary">Check For Updates</button>
          </form>
        </div>
      </section>

      <section class="services">
        {''.join(process_cards)}
      </section>
    </div>
  </main>
</body>
</html>"""
    return body.encode("utf-8")


def parse_form(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    length = int(handler.headers.get("content-length") or 0)
    raw = handler.rfile.read(length).decode("utf-8") if length else ""
    parsed = parse_qs(raw, keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def parse_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("content-length") or 0)
    raw = handler.rfile.read(length).decode("utf-8") if length else "{}"
    data = json.loads(raw or "{}")
    if not isinstance(data, dict):
        raise RuntimeError("JSON body must be an object.")
    return data


def redirect(handler: BaseHTTPRequestHandler, message: str = "") -> None:
    target = "/"
    if message:
        target = f"/?message={message.replace(' ', '+')}"
    handler.send_response(303)
    handler.send_header("location", target)
    handler.end_headers()


def make_handler(agent: StationAgent):
    class Handler(BaseHTTPRequestHandler):
        def end_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
            super().end_headers()

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self.end_headers()

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            query = parse_qs(urlparse(self.path).query)
            if path == "/status":
                self.send_json(200, agent.status())
                return
            if path == "/api/printers":
                self.send_json(200, {"ok": True, "printers": list_windows_printers()})
                return
            if path == "/":
                message = text((query.get("message") or [""])[0]).replace("+", " ")
                body = render_page(agent, message)
                self.send_response(200)
                self.send_header("content-type", "text/html; charset=utf-8")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_json(404, {"ok": False, "message": "Not found."})

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            try:
                if path == "/api/print-job":
                    payload = parse_json_body(self)
                    self.send_json(200, handle_remote_print_job(agent, payload))
                    return

                fields = parse_form(self)
                if path == "/setup/token":
                    agent.write_quick_setup(fields)
                    redirect(self, "Station connected")
                    return
                if path == "/config/save":
                    agent.write_config_from_form(fields)
                    redirect(self, "Config saved")
                    return
                if path == "/service/start":
                    service = fields.get("service", "")
                    agent.start_service(service)
                    redirect(self, "Service started")
                    return
                if path == "/service/stop":
                    service = fields.get("service", "")
                    agent.stop_service(service)
                    redirect(self, "Service stopped")
                    return
                if path == "/printer/test":
                    printer = deep_merge(default_config(), agent.config)["printer"]
                    zpl = zpl_test_label(
                        int_value(printer.get("default_label_width_mm"), 60),
                        int_value(printer.get("default_label_height_mm"), 40),
                    )
                    if printer.get("mode") == "network":
                        send_zpl_network(text(printer.get("network_host")), int_value(printer.get("network_port"), 9100), zpl)
                    else:
                        printer_name = text(printer.get("windows_printer_name"))
                        if not printer_name:
                            raise RuntimeError("Enter a Windows printer name first.")
                        send_zpl_windows(printer_name, zpl)
                    redirect(self, "ZPL test sent")
                    return
                if path == "/update/check":
                    info = agent.check_for_updates(force=True)
                    if info.get("available"):
                        redirect(self, f"Update {info.get('version')} available")
                    elif info.get("ok"):
                        redirect(self, "Station Agent is up to date")
                    else:
                        redirect(self, text(info.get("message")) or "Update check failed")
                    return
                if path == "/update/install":
                    target = agent.download_and_start_update()
                    redirect(self, f"Starting installer: {target.name}")
                    return
                self.send_json(404, {"ok": False, "message": "Not found."})
            except Exception as exc:
                redirect(self, f"Error: {exc}")

        def send_json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args: Any) -> None:
            print(f"{self.address_string()} - {fmt % args}")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Loopbase Station Agent")
    parser.add_argument("--config", default="config.local.json")
    parser.add_argument("--open", action="store_true", help="Open the local UI in the default browser.")
    args = parser.parse_args()

    config_path = resolve_cli_path(args.config)
    if not config_path.exists():
        example = app_dir() / "config.example.json"
        if example.exists():
            shutil.copyfile(example, config_path)
        else:
            save_config(config_path, default_config())

    agent = StationAgent(config_path)
    remote_print_thread = threading.Thread(target=agent.remote_print_poll_loop, name="remote-print-poll", daemon=True)
    remote_print_thread.start()

    host = text(agent.config.get("agent_host")) or "127.0.0.1"
    port = int_value(agent.config.get("agent_port"), 8790)
    server = ThreadingHTTPServer((host, port), make_handler(agent))

    def shutdown(*_: Any) -> None:
        print("Stopping Loopbase Station Agent...")
        agent.stop_all()
        server.shutdown()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    url = f"http://{host}:{port}"
    print(f"Loopbase Station Agent listening on {url}")
    print(f"Config: {config_path}")
    if args.open:
        webbrowser.open(url)

    server.serve_forever()


if __name__ == "__main__":
    main()
