from __future__ import annotations

import argparse
import json
import random
import signal
import string
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


def clean_tag(value: Any) -> str:
    if value is None:
        return ""
    return "".join(str(value).strip().split()).upper()


class TagStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tags: dict[str, dict[str, Any]] = {}
        self.scanning = False
        self.connected = False
        self.last_error = ""
        self.expected_quantity: int | None = None

    def add(self, tid: str, epc: str = "", rssi: Any = None) -> None:
        tid = clean_tag(tid)
        epc = clean_tag(epc)
        key = tid or epc
        if not key:
            return

        with self._lock:
            self._tags[key] = {
                "tid": tid or key,
                "epc": epc,
                "rssi": rssi,
                "seen_at": time.time(),
            }

    def clear(self) -> None:
        with self._lock:
            self._tags = {}

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            tags = sorted(self._tags.values(), key=lambda row: row["tid"])
            return {
                "connected": self.connected,
                "scanning": self.scanning,
                "expected_quantity": self.expected_quantity,
                "count": len(tags),
                "tids": [row["tid"] for row in tags],
                "tags": tags,
                "last_error": self.last_error,
            }


class RfidReader:
    def start(self, expected_quantity: int | None = None) -> None:
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError

    def close(self) -> None:
        self.stop()


class MockReader(RfidReader):
    def __init__(self, store: TagStore) -> None:
        self.store = store
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self, expected_quantity: int | None = None) -> None:
        self.stop()
        self.store.connected = True
        self.store.scanning = True
        self.store.last_error = ""
        self.store.expected_quantity = expected_quantity
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            target = self.store.expected_quantity or 8
            current = self.store.snapshot()["count"]
            if current < target:
                suffix = "".join(random.choice(string.hexdigits.upper()) for _ in range(16))
                self.store.add(f"E28011700000020D{suffix[:8]}")
            time.sleep(0.8)

    def stop(self) -> None:
        self._stop.set()
        self.store.scanning = False


class VendorUhfReader(RfidReader):
    def __init__(self, store: TagStore, mode: str, host: str, port: int, serial_port: str, baud: int, antenna: int) -> None:
        self.store = store
        self.mode = mode
        self.host = host
        self.port = port
        self.serial_port = serial_port
        self.baud = baud
        self.antenna = antenna
        self.client: Any = None
        self.uhf: Any = None

    def _load_sdk(self) -> Any:
        try:
            from uhf.reader import (  # type: ignore
                EnumG,
                GClient,
                MsgBaseInventoryEpc,
                MsgBaseStop,
                ParamEpcReadTid,
            )
        except Exception as exc:
            raise RuntimeError(
                "Could not import vendor package uhfReaderApi. Install it with: pip install uhfReaderApi"
            ) from exc

        return {
            "EnumG": EnumG,
            "GClient": GClient,
            "MsgBaseInventoryEpc": MsgBaseInventoryEpc,
            "MsgBaseStop": MsgBaseStop,
            "ParamEpcReadTid": ParamEpcReadTid,
        }

    def _ensure_connected(self) -> None:
        if self.client:
            return

        self.uhf = self._load_sdk()
        client = self.uhf["GClient"]()

        if self.mode == "tcp":
            ok = client.openTcp((self.host, self.port))
        elif self.mode == "serial":
            ok = client.openSerial((self.serial_port, self.baud))
        else:
            raise RuntimeError(f"Unsupported real reader mode: {self.mode}")

        if not ok:
            raise RuntimeError(f"RFID reader connection failed in {self.mode} mode.")

        client.callEpcInfo = self._on_epc
        if hasattr(client, "callEpcOver"):
            client.callEpcOver = self._on_epc_over
        self.client = client
        self.store.connected = True

    def _on_epc(self, epc_info: Any) -> None:
        if epc_info.result != 0:
            return

        tid = epc_info.tid
        epc = epc_info.epc
        rssi = getattr(epc_info, "rssi", None)
        self.store.add(tid or epc, epc=epc, rssi=rssi)

    def _on_epc_over(self, epc_over: Any) -> None:
        self.store.scanning = False

    def start(self, expected_quantity: int | None = None) -> None:
        self.store.last_error = ""
        self.store.expected_quantity = expected_quantity
        self._ensure_connected()

        try:
            enum_g = self.uhf["EnumG"]
            inventory_cls = self.uhf["MsgBaseInventoryEpc"]
            read_tid_cls = self.uhf["ParamEpcReadTid"]

            antenna = getattr(enum_g, f"AntennaNo_{self.antenna}").value
            continuous = enum_g.InventoryMode_Inventory.value
            auto_tid_mode = enum_g.ParamTidMode_Auto.value

            read_tid = read_tid_cls(mode=auto_tid_mode, dataLen=6)
            msg = inventory_cls(antennaEnable=antenna, inventoryMode=continuous)
            msg.readTid = read_tid

            result = self.client.sendSynMsg(msg)
            if result != 0:
                raise RuntimeError(getattr(msg, "rtMsg", "Inventory command failed."))

            self.store.scanning = True
        except Exception as exc:
            self.store.last_error = str(exc)
            self.store.scanning = False
            raise

    def stop(self) -> None:
        if self.client and self.uhf:
            try:
                msg = self.uhf["MsgBaseStop"]()
                self.client.sendSynMsg(msg)
            except Exception as exc:
                self.store.last_error = str(exc)
        self.store.scanning = False

    def close(self) -> None:
        self.stop()
        if self.client:
            try:
                self.client.close()
            except Exception:
                pass
        self.client = None
        self.store.connected = False


def make_handler(store: TagStore, reader: RfidReader):
    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, status: int, payload: dict[str, Any] | None = None) -> None:
            body = json.dumps(payload or {}, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("access-control-allow-origin", "*")
            self.send_header("access-control-allow-headers", "content-type")
            self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("content-length") or 0)
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8") or "{}")

        def do_OPTIONS(self) -> None:
            self._send_json(204)

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/status":
                self._send_json(200, store.snapshot())
                return
            self._send_json(404, {"ok": False, "message": "Not found."})

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            try:
                payload = self._read_json()

                if path == "/scan/start":
                    expected = payload.get("expected_quantity")
                    expected_quantity = int(expected) if expected not in (None, "") else None
                    reader.start(expected_quantity=expected_quantity)
                    self._send_json(200, {"ok": True, **store.snapshot()})
                    return

                if path == "/scan/stop":
                    reader.stop()
                    self._send_json(200, {"ok": True, **store.snapshot()})
                    return

                if path == "/clear":
                    store.clear()
                    self._send_json(200, {"ok": True, **store.snapshot()})
                    return

                self._send_json(404, {"ok": False, "message": "Not found."})
            except Exception as exc:
                store.last_error = str(exc)
                self._send_json(500, {"ok": False, "message": str(exc), **store.snapshot()})

        def log_message(self, fmt: str, *args: Any) -> None:
            print(f"{self.address_string()} - {fmt % args}")

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="StockMaster RFID receiving table bridge")
    parser.add_argument("--listen-host", default="127.0.0.1")
    parser.add_argument("--listen-port", type=int, default=8765)
    parser.add_argument("--mode", choices=["mock", "tcp", "serial"], default="mock")
    parser.add_argument("--reader-host", default="192.168.1.168")
    parser.add_argument("--reader-port", type=int, default=8160)
    parser.add_argument("--serial-port", default="COM7")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--antenna", type=int, default=1)
    args = parser.parse_args()

    store = TagStore()
    reader: RfidReader

    if args.mode == "mock":
        reader = MockReader(store)
    else:
        reader = VendorUhfReader(
            store,
            mode=args.mode,
            host=args.reader_host,
            port=args.reader_port,
            serial_port=args.serial_port,
            baud=args.baud,
            antenna=args.antenna,
        )

    server = ThreadingHTTPServer((args.listen_host, args.listen_port), make_handler(store, reader))

    def shutdown(*_: Any) -> None:
        print("Stopping RFID bridge...")
        reader.close()
        server.shutdown()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"RFID bridge listening on http://{args.listen_host}:{args.listen_port}")
    print(f"Reader mode: {args.mode}")
    if args.mode == "tcp":
        print(f"Reader TCP target: {args.reader_host}:{args.reader_port}")
    if args.mode == "serial":
        print(f"Reader serial target: {args.serial_port} @ {args.baud}")

    server.serve_forever()


if __name__ == "__main__":
    main()
