from __future__ import annotations

import argparse
import json
import random
import signal
import socket
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


VERSION = "loopbase-rfid-zone-monitor/0.1"
FRAME_HEAD = b"\xAA\xAA"
BROADCAST_ADDRESS = 0xFF


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


def now_ms() -> int:
    return int(time.time() * 1000)


def hex_compact(value: str) -> str:
    return "".join(ch for ch in text(value).upper() if ch in "0123456789ABCDEF")


def crc_ccitt(data: bytes) -> int:
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc


def build_frame(cmd_h: int, cmd_l: int, params: bytes = b"", address: int = BROADCAST_ADDRESS) -> bytes:
    length = 5 + len(params)
    body = bytes([address, length, cmd_h, cmd_l]) + params
    crc = crc_ccitt(FRAME_HEAD + body)
    return FRAME_HEAD + body + bytes([(crc >> 8) & 0xFF, crc & 0xFF])


def parse_frames(buffer: bytearray) -> list[bytes]:
    frames: list[bytes] = []
    while True:
        start = buffer.find(FRAME_HEAD)
        if start < 0:
            buffer.clear()
            return frames
        if start:
            del buffer[:start]
        if len(buffer) < 6:
            return frames
        length = buffer[3]
        frame_len = length + 3
        if frame_len < 8:
            del buffer[:2]
            continue
        if len(buffer) < frame_len:
            return frames
        frame = bytes(buffer[:frame_len])
        del buffer[:frame_len]
        expected = crc_ccitt(frame[:-2])
        actual = (frame[-2] << 8) | frame[-1]
        if expected == actual:
            frames.append(frame)
    return frames


def signed_byte(value: int) -> int:
    return value - 256 if value > 127 else value


@dataclass
class TagRead:
    tag_key: str
    epc: str
    tid: str = ""
    rssi: int | None = None
    antenna: int | None = None
    side: str = "unknown"
    seen_at_ms: int = field(default_factory=now_ms)


@dataclass
class TagPresence:
    tag_key: str
    epc: str
    tid: str = ""
    first_seen_ms: int = field(default_factory=now_ms)
    last_seen_ms: int = field(default_factory=now_ms)
    first_side: str = "unknown"
    last_side: str = "unknown"
    last_antenna: int | None = None
    max_rssi: int | None = None
    read_count: int = 0
    side_counts: dict[str, int] = field(default_factory=dict)

    def update(self, read: TagRead) -> None:
        if self.read_count == 0:
            self.first_seen_ms = read.seen_at_ms
            self.first_side = read.side
        self.epc = read.epc or self.epc
        self.tid = read.tid or self.tid
        self.last_seen_ms = read.seen_at_ms
        self.last_side = read.side
        self.last_antenna = read.antenna
        if read.rssi is not None and (self.max_rssi is None or read.rssi > self.max_rssi):
            self.max_rssi = read.rssi
        self.read_count += 1
        self.side_counts[read.side] = self.side_counts.get(read.side, 0) + 1


def parse_inventory_frame(frame: bytes, antenna_sides: dict[int, str]) -> TagRead | None:
    if len(frame) < 9:
        return None
    cmd_h = frame[4]
    cmd_l = frame[5]
    if cmd_h != 0xC1:
        return None
    status = frame[6]
    if status != 0x00:
        return None
    data = frame[7:-2]
    if cmd_l in {0x00, 0x01, 0x02}:
        if len(data) < 6:
            return None
        rssi = signed_byte(data[0])
        pc_word = (data[1] << 8) | data[2]
        epc_len = ((pc_word >> 11) & 0x1F) * 2
        if epc_len <= 0 or len(data) < 1 + 2 + epc_len + 2 + 1:
            return None
        epc = data[3 : 3 + epc_len].hex().upper()
        ant = data[3 + epc_len + 2] + 1
        tid = ""
    elif cmd_l in {0x10, 0x11, 0x12, 0x20, 0x21, 0x22, 0x30, 0x31, 0x32, 0x40, 0x41, 0x42}:
        if len(data) < 8:
            return None
        rssi = signed_byte(data[0])
        payload_len = data[1]
        pc_word = (data[2] << 8) | data[3]
        epc_len = ((pc_word >> 11) & 0x1F) * 2
        if epc_len <= 0 or payload_len < 5 or len(data) < 2 + payload_len:
            return None
        epc = data[4 : 4 + epc_len].hex().upper()
        idx = 4 + epc_len + 2
        ant = data[idx] + 1
        idx += 1
        tid = ""
        if cmd_l in {0x20, 0x21, 0x22, 0x40, 0x41, 0x42} and len(data) > idx:
            mem_len = data[idx]
            idx += 1
            tid = data[idx : idx + mem_len].hex().upper()
    else:
        return None
    tag_key = tid or epc
    if not tag_key:
        return None
    return TagRead(
        tag_key=tag_key,
        epc=epc,
        tid=tid,
        rssi=rssi,
        antenna=ant,
        side=antenna_sides.get(ant, f"antenna-{ant}"),
    )


def default_config() -> dict[str, Any]:
    return {
        "mode": "mock",
        "app_url": "https://loopbase.io",
        "zone_token": "",
        "listen_host": "127.0.0.1",
        "listen_port": 8775,
        "reader_host": "192.168.0.200",
        "reader_port": 200,
        "reader_address": 255,
        "q_value": 5,
        "algorithm": 2,
        "inventory_loops": 0,
        "read_tid": True,
        "auto_start_inventory": True,
        "apply_global_power_on_start": False,
        "global_power_dbm": 24,
        "apply_antenna_settings_on_start": False,
        "antenna_quantity": 4,
        "antenna_auto_polling": True,
        "antenna_ports": [
            {"antenna": 1, "enabled": True, "side": "outside", "power_dbm": 24, "inventory_count": 4},
            {"antenna": 2, "enabled": True, "side": "inside", "power_dbm": 24, "inventory_count": 4},
            {"antenna": 3, "enabled": False, "side": "outside", "power_dbm": 18, "inventory_count": 2},
            {"antenna": 4, "enabled": False, "side": "inside", "power_dbm": 18, "inventory_count": 2},
        ],
        "dedupe_window_seconds": 1.2,
        "present_ttl_seconds": 5,
        "transition_grace_seconds": 12,
        "room_stale_alert_seconds": 180,
        "event_history_limit": 300,
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
    }


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return default_config()
    with path.open("r", encoding="utf-8-sig") as handle:
        raw = json.load(handle)
    cfg = default_config()
    if isinstance(raw, dict):
        cfg.update(raw)
    return cfg


def save_config(path: Path, config: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")


class ZoneState:
    def __init__(self, config: dict[str, Any]) -> None:
        self.config = config
        self.lock = threading.Lock()
        self.active: dict[str, TagPresence] = {}
        self.room_items: dict[str, TagPresence] = {}
        self.events: list[dict[str, Any]] = []
        self.last_seen_key_ms: dict[str, int] = {}
        self.reads_total = 0
        self.last_error = ""
        self.last_post_error = ""
        self.last_alarm_error = ""
        self.alarm_active = False
        self.last_alarm_at_ms = 0
        self.trigger_alarm_output = None
        self.trigger_warning_output = None
        self.started_at_ms = now_ms()

    def antenna_sides(self) -> dict[int, str]:
        result: dict[int, str] = {}
        for row in self.config.get("antenna_ports") or []:
            if isinstance(row, dict):
                result[int_value(row.get("antenna"), 0)] = text(row.get("side")) or "unknown"
        return result

    def record_read(self, read: TagRead) -> None:
        dedupe_ms = max(0, float(self.config.get("dedupe_window_seconds") or 0) * 1000)
        with self.lock:
            previous_ms = self.last_seen_key_ms.get(read.tag_key, 0)
            if dedupe_ms and read.seen_at_ms - previous_ms < dedupe_ms:
                presence = self.active.get(read.tag_key)
                if presence:
                    presence.update(read)
                return
            self.last_seen_key_ms[read.tag_key] = read.seen_at_ms
            presence = self.active.get(read.tag_key)
            if not presence:
                presence = TagPresence(tag_key=read.tag_key, epc=read.epc, tid=read.tid)
                self.active[read.tag_key] = presence
            presence.update(read)
            self.reads_total += 1

    def sweep(self) -> None:
        ttl_ms = max(250, float(self.config.get("present_ttl_seconds") or 5) * 1000)
        current = now_ms()
        expired: list[TagPresence] = []
        with self.lock:
            for key, presence in list(self.active.items()):
                if current - presence.last_seen_ms >= ttl_ms:
                    expired.append(presence)
                    del self.active[key]
        for presence in expired:
            self._finalise_presence(presence)

    def _finalise_presence(self, presence: TagPresence) -> None:
        direction = "seen"
        if presence.first_side == "outside" and presence.last_side == "inside":
            direction = "entered"
        elif presence.first_side == "inside" and presence.last_side == "outside":
            direction = "exited"
        elif presence.last_side == "inside":
            direction = "inside"
        elif presence.last_side == "outside":
            direction = "outside"
        with self.lock:
            if direction in {"entered", "inside"}:
                self.room_items[presence.tag_key] = presence
            elif direction in {"exited", "outside"}:
                self.room_items.pop(presence.tag_key, None)
            event = self._presence_event(presence, direction)
            self.events.append(event)
            self.events = self.events[-int_value(self.config.get("event_history_limit"), 300) :]
        if self.should_warn_for_exit(event):
            self.request_warning("exit-intent")
        self.post_event(event)

    def should_warn_for_exit(self, event: dict[str, Any]) -> bool:
        if not bool_value(self.config.get("exit_warning_enabled")):
            return False
        if event.get("event_type") not in {"exited", "outside"}:
            return False
        min_rssi = int_value(self.config.get("exit_warning_min_rssi"), -48)
        min_reads = int_value(self.config.get("exit_warning_min_read_count"), 4)
        max_rssi = event.get("max_rssi")
        if max_rssi is not None and int(max_rssi) < min_rssi:
            return False
        return int_value(event.get("read_count"), 0) >= min_reads

    def request_alarm(self, reason: str = "app-alarm") -> None:
        callback = self.trigger_alarm_output
        with self.lock:
            self.alarm_active = True
            self.last_alarm_at_ms = now_ms()
        if callback:
            try:
                callback(reason)
            except Exception as exc:
                with self.lock:
                    self.last_alarm_error = str(exc)

    def request_warning(self, reason: str = "exit-warning") -> None:
        callback = self.trigger_warning_output
        if callback:
            try:
                callback(reason)
            except Exception as exc:
                with self.lock:
                    self.last_alarm_error = str(exc)

    def clear_alarm(self) -> None:
        with self.lock:
            self.alarm_active = False

    def _presence_event(self, presence: TagPresence, direction: str) -> dict[str, Any]:
        return {
            "event_type": direction,
            "tag_key": presence.tag_key,
            "epc": presence.epc,
            "tid": presence.tid,
            "first_side": presence.first_side,
            "last_side": presence.last_side,
            "last_antenna": presence.last_antenna,
            "max_rssi": presence.max_rssi,
            "read_count": presence.read_count,
            "first_seen_ms": presence.first_seen_ms,
            "last_seen_ms": presence.last_seen_ms,
            "dwell_seconds": round(max(0, presence.last_seen_ms - presence.first_seen_ms) / 1000, 3),
            "side_counts": dict(presence.side_counts),
        }

    def status(self) -> dict[str, Any]:
        self.sweep()
        current = now_ms()
        stale_after_ms = max(0, float(self.config.get("room_stale_alert_seconds") or 0) * 1000)
        with self.lock:
            active = [self._presence_event(p, "active") for p in self.active.values()]
            room_items = [self._presence_event(p, "inside") for p in self.room_items.values()]
            stale = [
                item
                for item in room_items
                if stale_after_ms and current - int(item["last_seen_ms"]) >= stale_after_ms
            ]
            return {
                "ok": True,
                "version": VERSION,
                "mode": self.config.get("mode"),
                "started_at_ms": self.started_at_ms,
                "reads_total": self.reads_total,
                "active_count": len(active),
                "inside_count": len(room_items),
                "stale_inside_count": len(stale),
                "last_error": self.last_error,
                "last_post_error": self.last_post_error,
                "last_alarm_error": self.last_alarm_error,
                "alarm_active": self.alarm_active,
                "last_alarm_at_ms": self.last_alarm_at_ms,
                "active": active,
                "inside": room_items,
                "stale_inside": stale,
                "events": list(reversed(self.events[-80:])),
            }

    def clear(self) -> None:
        with self.lock:
            self.active.clear()
            self.room_items.clear()
            self.events.clear()
            self.last_seen_key_ms.clear()
            self.reads_total = 0
            self.last_error = ""
            self.last_post_error = ""
            self.last_alarm_error = ""
            self.alarm_active = False

    def post_event(self, event: dict[str, Any]) -> None:
        app_url = text(self.config.get("app_url")).rstrip("/")
        token = text(self.config.get("zone_token"))
        if not app_url or not token:
            return
        payload = json.dumps({"source": VERSION, "events": [event]}).encode("utf-8")
        request = urllib.request.Request(
            f"{app_url}/api/v1/rfid-zone-events",
            data=payload,
            headers={
                "authorization": f"Bearer {token}",
                "content-type": "application/json",
                "user-agent": VERSION,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                raw = response.read()
                try:
                    result = json.loads(raw.decode("utf-8"))
                except Exception:
                    result = {}
            with self.lock:
                self.last_post_error = ""
            if (
                bool_value(self.config.get("alarm_trigger_on_app_alarm"))
                and int_value(result.get("alarm_count"), 0) > 0
            ):
                self.request_alarm("app-alarm")
        except Exception as exc:
            with self.lock:
                self.last_post_error = str(exc)


class Rux2xReader:
    def __init__(self, state: ZoneState) -> None:
        self.state = state
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.sock: socket.socket | None = None
        self.command_lock = threading.Lock()
        self.state.trigger_alarm_output = self.trigger_alarm
        self.state.trigger_warning_output = self.trigger_warning

    @property
    def config(self) -> dict[str, Any]:
        return self.state.config

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.stop_event.clear()
        mode = text(self.config.get("mode")) or "mock"
        if mode == "tcp_stream_server":
            target = self._run_tcp_stream_server
        elif mode == "tcp_command":
            target = self._run_tcp_command
        else:
            target = self._run_mock
        self.thread = threading.Thread(target=target, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass

    def trigger_alarm(self, reason: str = "alarm") -> None:
        if not bool_value(self.config.get("alarm_output_enabled")):
            return
        port = max(1, min(4, int_value(self.config.get("alarm_gpo_port"), 1)))
        active_level = 1 if int_value(self.config.get("alarm_active_level"), 1) else 0
        pulse_seconds = max(0, float(self.config.get("alarm_pulse_seconds") or 0))
        self.set_gpo_level(port, active_level)
        if pulse_seconds:
            threading.Timer(pulse_seconds, lambda: self.set_gpo_level(port, 1 - active_level)).start()

    def trigger_warning(self, reason: str = "warning") -> None:
        if not bool_value(self.config.get("exit_warning_enabled")):
            return
        port = max(1, min(4, int_value(self.config.get("exit_warning_gpo_port"), 2)))
        active_level = 1 if int_value(self.config.get("exit_warning_active_level"), 1) else 0
        pulse_seconds = max(0.05, float(self.config.get("exit_warning_pulse_seconds") or 0.4))
        self.set_gpo_level(port, active_level)
        threading.Timer(pulse_seconds, lambda: self.set_gpo_level(port, 1 - active_level)).start()

    def silence_alarm(self) -> None:
        port = max(1, min(4, int_value(self.config.get("alarm_gpo_port"), 1)))
        active_level = 1 if int_value(self.config.get("alarm_active_level"), 1) else 0
        self.set_gpo_level(port, 1 - active_level)
        self.state.clear_alarm()

    def set_gpo_level(self, port: int, level: int) -> None:
        if text(self.config.get("mode")) == "mock":
            return
        frame = self._gpo_level_frame(port, level)
        with self.command_lock:
            try:
                if self.sock:
                    self.sock.sendall(frame)
                    return
            except Exception:
                pass
            host = text(self.config.get("reader_host")) or "192.168.0.200"
            reader_port = int_value(self.config.get("reader_port"), 200)
            with socket.create_connection((host, reader_port), timeout=4) as conn:
                conn.sendall(frame)

    def _gpo_level_frame(self, port: int, level: int) -> bytes:
        address = int_value(self.config.get("reader_address"), BROADCAST_ADDRESS)
        clean_port = max(1, min(4, int(port)))
        clean_level = 1 if int(level) else 0
        return build_frame(0x0A, 0x00, bytes([0x11, clean_port, clean_level]), address=address)

    def _run_mock(self) -> None:
        tags = [
            ("E2000017221101441890A1B1", "E280110520007354D98408D8"),
            ("E2000017221101441890A1B2", "E280110520007354D98408D9"),
            ("E2000017221101441890A1B3", "E280110520007354D98408DA"),
        ]
        while not self.stop_event.is_set():
            epc, tid = random.choice(tags)
            for ant, side in [(1, "outside"), (2, "inside")]:
                self.state.record_read(
                    TagRead(
                        tag_key=tid,
                        epc=epc,
                        tid=tid,
                        rssi=random.randint(-68, -38),
                        antenna=ant,
                        side=side,
                    )
                )
                time.sleep(0.35)
            time.sleep(random.uniform(2.5, 4.5))

    def _run_tcp_stream_server(self) -> None:
        host = text(self.config.get("reader_stream_host")) or text(self.config.get("listen_host")) or "0.0.0.0"
        default_port = 8875 if int_value(self.config.get("reader_port"), 200) == int_value(self.config.get("listen_port"), 8775) else int_value(self.config.get("reader_port"), 200)
        port = int_value(self.config.get("reader_stream_port"), default_port)
        antenna_sides = self.state.antenna_sides()
        buffer = bytearray()
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock = server
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((host, port))
        server.listen(1)
        server.settimeout(1)
        while not self.stop_event.is_set():
            try:
                conn, _addr = server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            with conn:
                conn.settimeout(1)
                while not self.stop_event.is_set():
                    try:
                        data = conn.recv(4096)
                    except socket.timeout:
                        continue
                    except OSError:
                        break
                    if not data:
                        break
                    buffer.extend(data)
                    for frame in parse_frames(buffer):
                        read = parse_inventory_frame(frame, antenna_sides)
                        if read:
                            self.state.record_read(read)

    def _run_tcp_command(self) -> None:
        host = text(self.config.get("reader_host")) or "192.168.0.200"
        port = int_value(self.config.get("reader_port"), 200)
        antenna_sides = self.state.antenna_sides()
        while not self.stop_event.is_set():
            try:
                with socket.create_connection((host, port), timeout=6) as conn:
                    self.sock = conn
                    conn.settimeout(1)
                    if bool_value(self.config.get("apply_global_power_on_start")):
                        conn.sendall(self._global_power_frame())
                        time.sleep(0.2)
                    if bool_value(self.config.get("apply_antenna_settings_on_start")):
                        conn.sendall(self._antenna_settings_frame())
                        time.sleep(0.2)
                    if bool_value(self.config.get("auto_start_inventory")):
                        conn.sendall(self._inventory_frame())
                    buffer = bytearray()
                    while not self.stop_event.is_set():
                        try:
                            data = conn.recv(4096)
                        except socket.timeout:
                            continue
                        if not data:
                            break
                        buffer.extend(data)
                        for frame in parse_frames(buffer):
                            read = parse_inventory_frame(frame, antenna_sides)
                            if read:
                                self.state.record_read(read)
            except Exception as exc:
                self.state.last_error = str(exc)
                time.sleep(2)

    def _inventory_frame(self) -> bytes:
        address = int_value(self.config.get("reader_address"), BROADCAST_ADDRESS)
        q_value = max(0, min(15, int_value(self.config.get("q_value"), 5)))
        loops = max(0, min(65535, int_value(self.config.get("inventory_loops"), 0)))
        algorithm = max(0, min(2, int_value(self.config.get("algorithm"), 2)))
        if bool_value(self.config.get("read_tid")):
            cmd_l = 0x20 + algorithm
            params = bytes([q_value, (loops >> 8) & 0xFF, loops & 0xFF, 0x00, 0x00, 0x06, 0, 0, 0, 0])
        else:
            cmd_l = algorithm
            params = bytes([q_value, (loops >> 8) & 0xFF, loops & 0xFF])
        return build_frame(0xC1, cmd_l, params, address=address)

    def _stop_inventory_frame(self) -> bytes:
        address = int_value(self.config.get("reader_address"), BROADCAST_ADDRESS)
        return build_frame(0xC0, 0x00, b"", address=address)

    def _reset_reader_frame(self) -> bytes:
        address = int_value(self.config.get("reader_address"), BROADCAST_ADDRESS)
        return build_frame(0x0F, 0x00, b"", address=address)

    def _global_power_frame(self) -> bytes:
        address = int_value(self.config.get("reader_address"), BROADCAST_ADDRESS)
        power = max(0, min(3000, int(round(float(self.config.get("global_power_dbm", 24)) * 100))))
        return build_frame(0x3B, 0x00, bytes([(power >> 8) & 0xFF, power & 0xFF]), address=address)

    def send_reader_frame(self, frame: bytes, description: str) -> None:
        if text(self.config.get("mode")) == "mock":
            self.state.last_error = f"Mock mode: {description} skipped."
            return
        with self.command_lock:
            try:
                if self.sock:
                    self.sock.sendall(frame)
                    self.state.last_error = ""
                    return
            except Exception:
                pass
            host = text(self.config.get("reader_host")) or "192.168.0.200"
            reader_port = int_value(self.config.get("reader_port"), 200)
            with socket.create_connection((host, reader_port), timeout=4) as conn:
                conn.sendall(frame)
            self.state.last_error = ""

    def start_inventory(self) -> None:
        self.send_reader_frame(self._inventory_frame(), "start inventory")

    def stop_inventory(self) -> None:
        self.send_reader_frame(self._stop_inventory_frame(), "stop inventory")

    def apply_antenna_settings(self) -> None:
        self.send_reader_frame(self._antenna_settings_frame(), "apply antenna settings")

    def apply_global_power(self) -> None:
        self.send_reader_frame(self._global_power_frame(), "apply global RF power")

    def reset_reader(self) -> None:
        self.send_reader_frame(self._reset_reader_frame(), "reset reader")

    def _antenna_settings_frame(self) -> bytes:
        address = int_value(self.config.get("reader_address"), BROADCAST_ADDRESS)
        ports = [row for row in self.config.get("antenna_ports") or [] if isinstance(row, dict)]
        quantity = max(1, min(32, int_value(self.config.get("antenna_quantity"), len(ports) or 4)))
        enabled_mask = 0
        payload = bytearray([quantity, 0, 0, 0, 0, 1 if bool_value(self.config.get("antenna_auto_polling")) else 0])
        for idx in range(1, quantity + 1):
            row = next((p for p in ports if int_value(p.get("antenna"), 0) == idx), {})
            enabled = bool_value(row.get("enabled")) if row else idx == 1
            if enabled:
                enabled_mask |= 1 << (idx - 1)
            power = max(0, min(3000, int(round(float(row.get("power_dbm", 24)) * 100)))) if row else 2400
            inventory_count = max(1, min(65535, int_value(row.get("inventory_count"), 4))) if row else 4
            payload.extend([(power >> 8) & 0xFF, power & 0xFF, (inventory_count >> 8) & 0xFF, inventory_count & 0xFF])
        payload[1] = enabled_mask & 0xFF
        payload[2] = (enabled_mask >> 8) & 0xFF
        payload[3] = (enabled_mask >> 16) & 0xFF
        payload[4] = (enabled_mask >> 24) & 0xFF
        return build_frame(0x3F, 0x00, bytes(payload), address=address)


def make_handler(state: ZoneState, reader: Rux2xReader):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/status":
                self.send_json(200, state.status())
                return
            if path == "/":
                body = self.render_home()
                self.send_response(200)
                self.send_header("content-type", "text/html; charset=utf-8")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_json(404, {"ok": False, "message": "Not found."})

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            if path == "/clear":
                state.clear()
                self.send_response(303)
                self.send_header("location", "/")
                self.end_headers()
                return
            if path == "/alarm/silence":
                try:
                    reader.silence_alarm()
                    self.redirect_home()
                except Exception as exc:
                    state.last_alarm_error = str(exc)
                    self.redirect_home()
                return
            if path == "/alarm/test":
                try:
                    state.request_alarm("manual-test")
                    self.redirect_home()
                except Exception as exc:
                    state.last_alarm_error = str(exc)
                    self.redirect_home()
                return
            if path == "/warning/test":
                try:
                    state.request_warning("manual-test")
                    self.redirect_home()
                except Exception as exc:
                    state.last_alarm_error = str(exc)
                    self.redirect_home()
                return
            if path == "/reader/start-inventory":
                self.run_reader_command(reader.start_inventory)
                return
            if path == "/reader/stop-inventory":
                self.run_reader_command(reader.stop_inventory)
                return
            if path == "/reader/apply-antennas":
                self.run_reader_command(reader.apply_antenna_settings)
                return
            if path == "/reader/apply-power":
                self.run_reader_command(reader.apply_global_power)
                return
            if path == "/reader/reset":
                self.run_reader_command(reader.reset_reader)
                return
            self.send_json(404, {"ok": False, "message": "Not found."})

        def redirect_home(self) -> None:
            self.send_response(303)
            self.send_header("location", "/")
            self.end_headers()

        def run_reader_command(self, callback: Any) -> None:
            try:
                callback()
            except Exception as exc:
                state.last_error = str(exc)
            self.redirect_home()

        def render_home(self) -> bytes:
            data = state.status()
            active_rows = "".join(self.render_presence_row(row) for row in data["active"])
            inside_rows = "".join(self.render_presence_row(row) for row in data["inside"])
            event_rows = "".join(self.render_event_row(row) for row in data["events"][:30])
            body = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="2">
  <title>RFID Zone Monitor</title>
  <style>
    :root {{ color-scheme: dark; --bg:#070a0d; --panel:#101418; --line:#27313a; --text:#f5f7f8; --muted:#a4adb5; --green:#16a56a; --amber:#d59c26; --red:#d94444; }}
    body {{ margin:0; font-family:Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }}
    main {{ max-width:1220px; margin:0 auto; padding:24px; }}
    header, section {{ border:1px solid var(--line); border-radius:14px; background:var(--panel); padding:18px; margin-bottom:14px; }}
    header {{ display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }}
    h1,h2,p {{ margin:0; }} h1 {{ font-size:28px; }} h2 {{ font-size:17px; margin-bottom:10px; }}
    .muted {{ color:var(--muted); font-weight:700; margin-top:6px; }}
    .stats {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:14px; }}
    .stat {{ border:1px solid var(--line); border-radius:12px; padding:12px; background:#0b0f12; }}
    .stat b {{ display:block; font-size:26px; }}
    .grid {{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }}
    table {{ width:100%; border-collapse:collapse; font-size:13px; }}
    th,td {{ text-align:left; border-bottom:1px solid #202a32; padding:8px; vertical-align:top; }}
    th {{ color:#cbd4db; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }}
    code {{ color:#8ee6bd; }}
    .actions {{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }}
    button {{ border:0; border-radius:10px; background:#26313a; color:white; padding:10px 14px; font-weight:900; cursor:pointer; }}
    button.danger {{ background:var(--red); }}
    button.green {{ background:var(--green); }}
    @media(max-width:900px) {{ .grid,.stats {{ grid-template-columns:1fr; }} header {{ flex-direction:column; }} }}
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>RFID Zone Monitor</h1>
      <p class="muted">Deduped continuous reads for fitting-room doors, exits, and other threshold zones.</p>
    </div>
    <div class="actions">
      <form method="post" action="/alarm/silence"><button class="danger">Turn Off Built-in Alarm</button></form>
      <form method="post" action="/alarm/test"><button>Test Built-in Alarm/Light</button></form>
      <form method="post" action="/warning/test"><button>Test Built-in Warning</button></form>
      <form method="post" action="/reader/start-inventory"><button class="green">Start Inventory</button></form>
      <form method="post" action="/reader/stop-inventory"><button>Stop Inventory</button></form>
      <form method="post" action="/reader/apply-antennas"><button>Apply Antennas</button></form>
      <form method="post" action="/reader/apply-power"><button>Apply Power</button></form>
      <form method="post" action="/reader/reset" onsubmit="return confirm('Reset the RFID reader now?')"><button>Reset Reader</button></form>
      <form method="post" action="/clear"><button>Clear Monitor</button></form>
    </div>
  </header>
  <section>
    <h2>Live State</h2>
    <div class="stats">
      <div class="stat"><span>Mode</span><b>{data["mode"]}</b></div>
      <div class="stat"><span>Active Reads</span><b>{data["active_count"]}</b></div>
      <div class="stat"><span>Inside</span><b>{data["inside_count"]}</b></div>
      <div class="stat"><span>Stale Inside</span><b>{data["stale_inside_count"]}</b></div>
    </div>
    <p class="muted">Total deduped reads: {data["reads_total"]}. Alarm output: {"active" if data["alarm_active"] else "idle"}. Last reader error: {data["last_error"] or "None"}. Last app post error: {data["last_post_error"] or "None"}. Last alarm error: {data["last_alarm_error"] or "None"}.</p>
  </section>
  <div class="grid">
    <section><h2>Currently In Beam</h2><table><thead><tr><th>Tag</th><th>Side</th><th>Antenna</th><th>RSSI</th><th>Reads</th></tr></thead><tbody>{active_rows or '<tr><td colspan="5">No active reads.</td></tr>'}</tbody></table></section>
    <section><h2>Inside Zone</h2><table><thead><tr><th>Tag</th><th>Side</th><th>Antenna</th><th>RSSI</th><th>Reads</th></tr></thead><tbody>{inside_rows or '<tr><td colspan="5">No inside items.</td></tr>'}</tbody></table></section>
  </div>
  <section><h2>Recent Events</h2><table><thead><tr><th>Event</th><th>Tag</th><th>Path</th><th>Antenna</th><th>RSSI</th></tr></thead><tbody>{event_rows or '<tr><td colspan="5">No events yet.</td></tr>'}</tbody></table></section>
</main>
</body>
</html>"""
            return body.encode("utf-8")

        def render_presence_row(self, row: dict[str, Any]) -> str:
            tag = row.get("tid") or row.get("epc") or row.get("tag_key")
            return (
                "<tr>"
                f"<td><code>{tag}</code></td>"
                f"<td>{row.get('last_side')}</td>"
                f"<td>{row.get('last_antenna') or ''}</td>"
                f"<td>{row.get('max_rssi') if row.get('max_rssi') is not None else ''}</td>"
                f"<td>{row.get('read_count') or ''}</td>"
                "</tr>"
            )

        def render_event_row(self, row: dict[str, Any]) -> str:
            tag = row.get("tid") or row.get("epc") or row.get("tag_key")
            path = f"{row.get('first_side')} -> {row.get('last_side')}"
            return (
                "<tr>"
                f"<td>{row.get('event_type', '')}</td>"
                f"<td><code>{tag}</code></td>"
                f"<td>{path}</td>"
                f"<td>{row.get('last_antenna') or ''}</td>"
                f"<td>{row.get('max_rssi') if row.get('max_rssi') is not None else ''}</td>"
                "</tr>"
            )

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
    parser = argparse.ArgumentParser(description="Loopbase RFID zone monitor for RUX2X/RU4XX threshold readers.")
    parser.add_argument("--config", default="config.local.json")
    parser.add_argument("--mode", choices=["mock", "tcp_command", "tcp_stream_server"], default="")
    parser.add_argument("--listen-host", default="")
    parser.add_argument("--listen-port", type=int, default=0)
    parser.add_argument("--reader-host", default="")
    parser.add_argument("--reader-port", type=int, default=0)
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    if not config_path.exists():
        save_config(config_path, default_config())
    config = load_config(config_path)
    if args.mode:
        config["mode"] = args.mode
    if args.listen_host:
        config["listen_host"] = args.listen_host
    if args.listen_port:
        config["listen_port"] = args.listen_port
    if args.reader_host:
        config["reader_host"] = args.reader_host
    if args.reader_port:
        config["reader_port"] = args.reader_port

    state = ZoneState(config)
    reader = Rux2xReader(state)
    reader.start()

    host = text(config.get("listen_host")) or "127.0.0.1"
    port = int_value(config.get("listen_port"), 8775)
    server = ThreadingHTTPServer((host, port), make_handler(state, reader))

    def shutdown(*_: Any) -> None:
        reader.stop()
        server.shutdown()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"RFID zone monitor listening on http://{host}:{port}")
    print(f"Reader mode: {config.get('mode')}")
    print(f"Config: {config_path}")
    server.serve_forever()


if __name__ == "__main__":
    main()
