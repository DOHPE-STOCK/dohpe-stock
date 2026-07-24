from __future__ import annotations

import argparse
import hashlib
import html
import json
import mimetypes
import os
import signal
import sqlite3
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError


WORKER_VERSION = "loopbase-photo-ingest-worker/0.1"
BACKGROUND_REMOVAL_TIMEOUT_SECONDS = 240


@dataclass
class SourceConfig:
    name: str
    token: str
    watch_folder: Path
    processed_folder: Path | None
    trash_folder: Path | None
    extensions: set[str]
    raw_extensions: set[str]


@dataclass
class WorkerConfig:
    app_url: str
    database_path: Path
    scan_interval_seconds: float
    stable_seconds: float
    max_upload_attempts: int
    enable_processing_jobs: bool
    sources: list[SourceConfig]


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def load_config(path: Path) -> WorkerConfig:
    with path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)

    sources: list[SourceConfig] = []
    for row in raw.get("sources", []):
        name = text(row.get("name"))
        token = text(row.get("token"))
        folder = Path(text(row.get("watch_folder")))
        processed_folder_text = text(row.get("processed_folder"))
        trash_folder_text = text(row.get("trash_folder"))
        extensions = {
            ext.lower() if ext.startswith(".") else f".{ext.lower()}"
            for ext in row.get("extensions", [".jpg", ".jpeg"])
        }
        raw_extensions = {
            ext.lower() if ext.startswith(".") else f".{ext.lower()}"
            for ext in row.get("raw_extensions", [".nef", ".arw", ".cr2", ".cr3", ".raf", ".dng"])
        }

        if not name or not token or not folder:
            continue

        sources.append(
            SourceConfig(
                name=name,
                token=token,
                watch_folder=folder,
                processed_folder=Path(processed_folder_text) if processed_folder_text else None,
                trash_folder=Path(trash_folder_text) if trash_folder_text else None,
                extensions=extensions,
                raw_extensions=raw_extensions,
            )
        )

    if not sources:
        raise RuntimeError("No valid sources configured.")

    return WorkerConfig(
        app_url=text(raw.get("app_url") or "http://localhost:3000").rstrip("/"),
        database_path=Path(text(raw.get("database_path") or "photo_ingest_worker.sqlite3")),
        scan_interval_seconds=float(raw.get("scan_interval_seconds") or 2),
        stable_seconds=float(raw.get("stable_seconds") or 3),
        max_upload_attempts=int(raw.get("max_upload_attempts") or 20),
        enable_processing_jobs=raw.get("enable_processing_jobs") is True,
        sources=sources,
    )


def default_config_json() -> dict[str, Any]:
    return {
        "app_url": "http://localhost:3000",
        "database_path": "photo_ingest_worker.sqlite3",
        "scan_interval_seconds": 2,
        "stable_seconds": 3,
        "max_upload_attempts": 20,
        "enable_processing_jobs": False,
        "sources": [],
    }


def is_jpeg_path(path: Path) -> bool:
    return path.suffix.lower() in {".jpg", ".jpeg"}


def load_config_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return default_config_json()

    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    base = default_config_json()
    base.update(data)
    if not isinstance(base.get("sources"), list):
        base["sources"] = []
    return base


def apply_setup_prefill(data: dict[str, Any], query: str) -> dict[str, Any]:
    params = parse_qs(query, keep_blank_values=True)
    app_url = text(params.get("app_url", [""])[0])
    source_name = text(params.get("source_name", [""])[0])
    source_token = text(params.get("source_token", [""])[0])

    if app_url:
        data["app_url"] = app_url

    if source_name or source_token:
        sources = data.get("sources") if isinstance(data.get("sources"), list) else []
        source = {
            "name": source_name,
            "token": source_token,
            "watch_folder": "",
            "processed_folder": "",
            "trash_folder": "",
            "extensions": [".jpg", ".jpeg"],
            "raw_extensions": [".nef", ".arw", ".cr2", ".cr3", ".raf", ".dng"],
        }

        replaced = False
        for index, existing in enumerate(sources):
            if not text(existing.get("token")) and not text(existing.get("watch_folder")):
                merged = dict(existing)
                if source_name:
                    merged["name"] = source_name
                if source_token:
                    merged["token"] = source_token
                sources[index] = merged
                replaced = True
                break

        if not replaced:
            sources.append(source)

        data["sources"] = sources

    return data


def save_config_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")


def connect_db(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma journal_mode = wal")
    conn.execute(
        """
        create table if not exists files (
          id text primary key,
          source_name text not null,
          path text not null,
          size_bytes integer not null default 0,
          mtime real not null default 0,
          sha256 text,
          state text not null default 'seen',
          attempts integer not null default 0,
          last_error text,
          remote_capture_id text,
          remote_item_image_id text,
          first_seen_at real not null,
          last_seen_at real not null,
          uploaded_at real,
          unique (source_name, path)
        )
        """
    )
    for statement in [
        "alter table files add column file_kind text not null default 'jpeg'",
        "alter table files add column pair_key text",
        "alter table files add column paired_remote_capture_id text",
    ]:
        try:
            conn.execute(statement)
        except sqlite3.OperationalError as exc:
            if "duplicate column name" not in str(exc).lower():
                raise
    conn.execute(
        """
        create table if not exists worker_commands (
          id text primary key,
          source_name text not null,
          command_type text not null,
          remote_capture_id text,
          status text not null default 'queued',
          attempts integer not null default 0,
          last_error text,
          received_at real not null,
          completed_at real
        )
        """
    )
    conn.execute(
        """
        create table if not exists processing_jobs (
          id text primary key,
          source_name text not null,
          remote_capture_id text not null,
          job_type text not null,
          status text not null default 'queued',
          attempts integer not null default 0,
          last_error text,
          received_at real not null,
          completed_at real
        )
        """
    )
    conn.commit()
    return conn


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_stable(path: Path, stable_seconds: float) -> tuple[bool, int, float]:
    first = path.stat()
    size = first.st_size
    mtime = first.st_mtime
    time.sleep(min(stable_seconds, 1.0))
    second = path.stat()
    stable = size == second.st_size and mtime == second.st_mtime and (time.time() - second.st_mtime) >= stable_seconds
    return stable, second.st_size, second.st_mtime


def upsert_seen_file(conn: sqlite3.Connection, source: SourceConfig, path: Path, size: int, mtime: float) -> sqlite3.Row:
    now = time.time()
    file_id = str(uuid.uuid4())
    file_kind = "raw" if path.suffix.lower() in source.raw_extensions else "jpeg"
    pair_key = f"{source.name}:{path.parent}:{path.stem.lower()}"
    conn.execute(
        """
        insert into files (id, source_name, path, size_bytes, mtime, file_kind, pair_key, first_seen_at, last_seen_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(source_name, path) do update set
          size_bytes = excluded.size_bytes,
          mtime = excluded.mtime,
          file_kind = excluded.file_kind,
          pair_key = excluded.pair_key,
          last_seen_at = excluded.last_seen_at
        """,
        (file_id, source.name, str(path), size, mtime, file_kind, pair_key, now, now),
    )
    conn.commit()
    return conn.execute(
        "select * from files where source_name = ? and path = ?",
        (source.name, str(path)),
    ).fetchone()


def mark_file(conn: sqlite3.Connection, file_id: str, **fields: Any) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values())
    values.append(file_id)
    conn.execute(f"update files set {assignments} where id = ?", values)
    conn.commit()


def api_json(config: WorkerConfig, source: SourceConfig, path: str, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = None
    headers = {
        "Authorization": f"Bearer {source.token}",
    }
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urlrequest.Request(
        f"{config.app_url}{path}",
        data=body,
        method=method,
        headers=headers,
    )

    try:
        with urlrequest.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {raw}") from exc
    except URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc

    data = json.loads(raw or "{}")
    if not data.get("ok"):
        raise RuntimeError(data.get("message") or data.get("error") or "API request failed.")
    return data


def report_command(config: WorkerConfig, source: SourceConfig, command_id: str, status: str, message: str = "", attempts: int = 0) -> None:
    api_json(
        config,
        source,
        "/api/v1/photo-worker-commands",
        "PATCH",
        {
            "command_id": command_id,
            "status": status,
            "message": message,
            "attempts": attempts,
        },
    )


def constrained_destination(source: SourceConfig, command_type: str, original_path: Path) -> Path | None:
    if command_type == "move_source_to_processed":
        base = source.processed_folder
    elif command_type == "move_source_to_trash":
        base = source.trash_folder
    else:
        return None

    if base is None:
        return None

    base.mkdir(parents=True, exist_ok=True)
    destination = base / original_path.name
    if destination.exists():
        destination = base / f"{original_path.stem}-{int(time.time())}{original_path.suffix}"
    return destination


def process_worker_command(config: WorkerConfig, conn: sqlite3.Connection, source: SourceConfig, command: dict[str, Any]) -> None:
    command_id = text(command.get("id"))
    command_type = text(command.get("command_type"))
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}
    remote_capture_id = text(payload.get("remote_capture_id") or command.get("capture_id"))
    attempts = int(command.get("attempts") or 0)

    if not command_id:
        return

    conn.execute(
        """
        insert into worker_commands (id, source_name, command_type, remote_capture_id, status, attempts, received_at)
        values (?, ?, ?, ?, 'queued', ?, ?)
        on conflict(id) do nothing
        """,
        (command_id, source.name, command_type, remote_capture_id, attempts, time.time()),
    )
    conn.commit()

    row = conn.execute(
        "select * from files where source_name = ? and remote_capture_id = ?",
        (source.name, remote_capture_id),
    ).fetchone()

    if not row:
        report_command(config, source, command_id, "failed", "Known local file record not found.", attempts)
        conn.execute(
            "update worker_commands set status = 'failed', attempts = attempts + 1, last_error = ? where id = ?",
            ("Known local file record not found.", command_id),
        )
        conn.commit()
        return

    try:
        report_command(config, source, command_id, "running", "", attempts)

        related_rows = [row]
        raw_rows = conn.execute(
            "select * from files where source_name = ? and paired_remote_capture_id = ?",
            (source.name, remote_capture_id),
        ).fetchall()
        related_rows.extend(raw_rows)

        for local_row in related_rows:
            path = Path(local_row["path"])

            if command_type == "delete_source_file":
                if path.exists():
                    path.unlink()
                mark_file(conn, local_row["id"], state="local_deleted")
            elif command_type in {"move_source_to_processed", "move_source_to_trash"}:
                destination = constrained_destination(source, command_type, path)
                if destination is None:
                    raise RuntimeError(f"No destination folder configured for {command_type}.")
                if path.exists():
                    path.replace(destination)
                    mark_file(conn, local_row["id"], path=str(destination), state="local_moved")
                else:
                    mark_file(conn, local_row["id"], state="local_missing")
            else:
                raise RuntimeError(f"Unsupported command type: {command_type}")

        report_command(config, source, command_id, "completed")
        conn.execute(
            "update worker_commands set status = 'completed', completed_at = ? where id = ?",
            (time.time(), command_id),
        )
        conn.commit()
    except Exception as exc:
        report_command(config, source, command_id, "failed", str(exc), attempts)
        conn.execute(
            "update worker_commands set status = 'failed', attempts = attempts + 1, last_error = ? where id = ?",
            (str(exc), command_id),
        )
        conn.commit()


def poll_worker_commands(config: WorkerConfig, conn: sqlite3.Connection, source: SourceConfig) -> None:
    try:
        data = api_json(config, source, "/api/v1/photo-worker-commands")
        for command in data.get("commands", []):
            process_worker_command(config, conn, source, command)
    except Exception as exc:
        print(f"[{source.name}] command poll failed: {exc}")


def report_processing_job(config: WorkerConfig, source: SourceConfig, job_id: str, status: str, message: str = "", attempts: int = 0) -> None:
    api_json(
        config,
        source,
        "/api/v1/photo-processing-jobs",
        "PATCH",
        {
            "job_id": job_id,
            "status": status,
            "message": message,
            "attempts": attempts,
        },
    )


def upload_processing_result(
    config: WorkerConfig,
    source: SourceConfig,
    job_id: str,
    representation_type: str,
    metadata: dict[str, Any],
    file_path: Path | None = None,
    measurement_suggestions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    fields = {
        "job_id": job_id,
        "representation_type": representation_type,
        "metadata": json.dumps(metadata, separators=(",", ":")),
        "measurement_suggestions": json.dumps(measurement_suggestions or [], separators=(",", ":")),
    }

    if file_path is not None:
        fields["original_filename"] = file_path.name
        fields["sha256"] = sha256_file(file_path)
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        body, boundary = multipart_body(fields, "file", file_path, content_type)
    else:
        boundary = f"----LoopbaseBoundary{uuid.uuid4().hex}"
        chunks: list[bytes] = []
        for key, value in fields.items():
            chunks.append(f"--{boundary}\r\n".encode("utf-8"))
            chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
            chunks.append(str(value).encode("utf-8"))
            chunks.append(b"\r\n")
        chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
        body = b"".join(chunks)

    req = urlrequest.Request(
        f"{config.app_url}/api/v1/photo-processing-results",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {source.token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )

    try:
        with urlrequest.urlopen(req, timeout=90) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {raw}") from exc
    except URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc

    data = json.loads(raw or "{}")
    if not data.get("ok"):
        raise RuntimeError(data.get("message") or data.get("error") or "Processing result upload failed.")
    return data


def local_file_for_capture(conn: sqlite3.Connection, source: SourceConfig, remote_capture_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        select * from files
        where source_name = ?
          and remote_capture_id = ?
          and file_kind = 'jpeg'
        order by uploaded_at desc
        limit 1
        """,
        (source.name, remote_capture_id),
    ).fetchone()


def local_raw_file_for_capture(conn: sqlite3.Connection, source: SourceConfig, remote_capture_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        select * from files
        where source_name = ?
          and paired_remote_capture_id = ?
          and file_kind = 'raw'
        order by last_seen_at desc
        limit 1
        """,
        (source.name, remote_capture_id),
    ).fetchone()


def processing_output_folder(source: SourceConfig) -> Path:
    base = source.processed_folder or source.watch_folder / "loopbase-processed"
    folder = base / "loopbase-processing-results"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def make_output_path(source: SourceConfig, input_path: Path, suffix: str, extension: str) -> Path:
    folder = processing_output_folder(source)
    safe_stem = input_path.stem.replace(" ", "_")
    return folder / f"{safe_stem}-{suffix}-{int(time.time())}{extension}"


def create_pillow_preview(input_path: Path, output_path: Path, max_size: int = 1800) -> dict[str, Any]:
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise RuntimeError("Pillow is not installed. Install with: pip install Pillow") from exc

    with Image.open(input_path) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((max_size, max_size))
        if image.mode not in {"RGB", "L"}:
            image = image.convert("RGB")
        image.save(output_path, "JPEG", quality=92, optimize=True)
        return {
            "width": image.width,
            "height": image.height,
            "max_size": max_size,
            "engine": "Pillow",
        }


def remove_background(input_path: Path, output_path: Path) -> dict[str, Any]:
    script = """
from pathlib import Path
import sys

try:
    from rembg import remove
except ImportError as exc:
    raise SystemExit("rembg is not installed. Install with: pip install rembg") from exc

input_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
output_path.write_bytes(remove(input_path.read_bytes()))
"""

    try:
        result = subprocess.run(
            [sys.executable, "-c", script, str(input_path), str(output_path)],
            capture_output=True,
            text=True,
            timeout=BACKGROUND_REMOVAL_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"Background removal timed out after {BACKGROUND_REMOVAL_TIMEOUT_SECONDS} seconds. "
            "This is usually the rembg model download or a very large source image."
        ) from exc

    if result.returncode != 0:
        error = (result.stderr or result.stdout or "Background removal failed.").strip()
        raise RuntimeError(error)

    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise RuntimeError("Background removal finished without creating an output image.")

    return {
        "engine": "rembg",
        "output_format": "png",
        "timeout_seconds": BACKGROUND_REMOVAL_TIMEOUT_SECONDS,
    }


def detect_aruco_metadata(input_path: Path, calibration_profiles: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is not installed. Install with: pip install opencv-contrib-python") from exc

    image = cv2.imread(str(input_path))
    if image is None:
        raise RuntimeError("OpenCV could not read the source image.")

    aruco = getattr(cv2, "aruco", None)
    if aruco is None:
        raise RuntimeError("OpenCV ArUco module is unavailable. Install opencv-contrib-python.")

    dictionary = aruco.getPredefinedDictionary(aruco.DICT_4X4_50)
    parameters = aruco.DetectorParameters()
    detector = aruco.ArucoDetector(dictionary, parameters)
    corners, ids, _rejected = detector.detectMarkers(image)

    marker_ids = [int(value[0]) for value in ids] if ids is not None else []
    profile_refs = [
        {
            "profile_id": profile.get("id"),
            "profile_type": profile.get("profile_type"),
            "measured_reference": profile.get("measured_reference") or {},
            "calibration_data": profile.get("calibration_data") or {},
        }
        for profile in calibration_profiles
    ]

    return {
        "engine": "opencv-aruco",
        "image_width": int(image.shape[1]),
        "image_height": int(image.shape[0]),
        "detected_marker_count": len(marker_ids),
        "detected_marker_ids": marker_ids,
        "calibration_profiles": profile_refs,
        "measurement_note": "ArUco references detected only. Garment measurement suggestions require a defined measurement-line/edge model.",
    }


def develop_raw_preview(raw_path: Path, output_path: Path) -> dict[str, Any]:
    try:
        import rawpy
    except ImportError as exc:
        raise RuntimeError("rawpy is not installed. Install with: pip install rawpy") from exc

    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow is not installed. Install with: pip install Pillow") from exc

    with rawpy.imread(str(raw_path)) as raw:
        rgb = raw.postprocess(use_camera_wb=True, output_bps=8)

    image = Image.fromarray(rgb)
    image.thumbnail((2200, 2200))
    image.save(output_path, "JPEG", quality=92, optimize=True)
    return {
        "engine": "rawpy",
        "width": image.width,
        "height": image.height,
        "raw_path": str(raw_path),
    }


def process_photo_job(config: WorkerConfig, conn: sqlite3.Connection, source: SourceConfig, job: dict[str, Any]) -> None:
    job_id = text(job.get("id"))
    job_type = text(job.get("job_type"))
    remote_capture_id = text(job.get("capture_id"))
    attempts = int(job.get("attempts") or 0)

    if not job_id or not remote_capture_id:
        return

    conn.execute(
        """
        insert into processing_jobs (id, source_name, remote_capture_id, job_type, status, attempts, received_at)
        values (?, ?, ?, ?, 'queued', ?, ?)
        on conflict(id) do nothing
        """,
        (job_id, source.name, remote_capture_id, job_type, attempts, time.time()),
    )
    conn.commit()

    try:
        report_processing_job(config, source, job_id, "processing", "", attempts)
        conn.execute(
            "update processing_jobs set status = 'processing' where id = ?",
            (job_id,),
        )
        conn.commit()

        file_row = local_file_for_capture(conn, source, remote_capture_id)
        if not file_row:
            raise RuntimeError("Local source JPEG for this capture was not found on this station.")

        local_path = Path(file_row["path"])
        if not local_path.exists():
            raise RuntimeError("Local source JPEG no longer exists on this station.")

        if job_type == "background_removal":
            output_path = make_output_path(source, local_path, "background-removed", ".png")
            metadata = remove_background(local_path, output_path)
            upload_processing_result(
                config,
                source,
                job_id,
                "background_removed",
                {
                    **metadata,
                    "worker_version": WORKER_VERSION,
                    "source_path": str(local_path),
                },
                output_path,
            )
            conn.execute(
                "update processing_jobs set status = 'completed', completed_at = ? where id = ?",
                (time.time(), job_id),
            )
            conn.commit()
            return

        if job_type == "measurement_analysis":
            metadata = detect_aruco_metadata(local_path, job.get("calibration_profiles") or [])
            upload_processing_result(
                config,
                source,
                job_id,
                "measurement_analysis",
                {
                    **metadata,
                    "worker_version": WORKER_VERSION,
                    "source_path": str(local_path),
                },
                None,
                [],
            )
            conn.execute(
                "update processing_jobs set status = 'completed', completed_at = ? where id = ?",
                (time.time(), job_id),
            )
            conn.commit()
            return

        if job_type in {"calibrated_preview", "processed_preview", "product_master", "derivative"}:
            suffix = job_type.replace("_", "-")
            output_path = make_output_path(source, local_path, suffix, ".jpg")
            metadata = create_pillow_preview(local_path, output_path)
            upload_processing_result(
                config,
                source,
                job_id,
                "calibrated_preview" if job_type == "calibrated_preview" else "processed_preview",
                {
                    **metadata,
                    "worker_version": WORKER_VERSION,
                    "source_path": str(local_path),
                    "calibration_applied": False,
                    "calibration_note": "Preview generated with EXIF orientation and resize only. Colour/geometry transforms are not applied yet.",
                },
                output_path,
            )
            conn.execute(
                "update processing_jobs set status = 'completed', completed_at = ? where id = ?",
                (time.time(), job_id),
            )
            conn.commit()
            return

        if job_type == "raw_development":
            raw_row = local_raw_file_for_capture(conn, source, remote_capture_id)
            if not raw_row:
                raise RuntimeError("No paired local RAW file was found for this capture.")
            raw_path = Path(raw_row["path"])
            if not raw_path.exists():
                raise RuntimeError("Paired local RAW file no longer exists on this station.")
            output_path = make_output_path(source, raw_path, "raw-developed", ".jpg")
            metadata = develop_raw_preview(raw_path, output_path)
            upload_processing_result(
                config,
                source,
                job_id,
                "processed_preview",
                {
                    **metadata,
                    "worker_version": WORKER_VERSION,
                    "source_path": str(raw_path),
                },
                output_path,
            )
            conn.execute(
                "update processing_jobs set status = 'completed', completed_at = ? where id = ?",
                (time.time(), job_id),
            )
            conn.commit()
            return

        raise RuntimeError(f"Unsupported processing job type: {job_type}")
    except Exception as exc:
        report_processing_job(config, source, job_id, "failed", str(exc), attempts)
        conn.execute(
            "update processing_jobs set status = 'failed', attempts = attempts + 1, last_error = ?, completed_at = ? where id = ?",
            (str(exc), time.time(), job_id),
        )
        conn.commit()


def poll_processing_jobs(config: WorkerConfig, conn: sqlite3.Connection, source: SourceConfig) -> None:
    if not config.enable_processing_jobs:
        return

    try:
        data = api_json(config, source, "/api/v1/photo-processing-jobs")
        for job in data.get("jobs", []):
            process_photo_job(config, conn, source, job)
    except Exception as exc:
        print(f"[{source.name}] processing job poll failed: {exc}")


def multipart_body(fields: dict[str, str], file_field: str, file_path: Path, content_type: str) -> tuple[bytes, str]:
    boundary = f"----LoopbaseBoundary{uuid.uuid4().hex}"
    chunks: list[bytes] = []

    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    filename = file_path.name.replace('"', "_")
    chunks.append(f"--{boundary}\r\n".encode("utf-8"))
    chunks.append(
        (
            f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
    )
    chunks.append(file_path.read_bytes())
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))

    return b"".join(chunks), boundary


def find_raw_pair(conn: sqlite3.Connection, source: SourceConfig, jpeg_path: Path) -> dict[str, Any] | None:
    raw_paths = [
        jpeg_path.with_suffix(extension)
        for extension in source.raw_extensions
    ]
    raw_paths.extend(
        jpeg_path.with_suffix(extension.upper())
        for extension in source.raw_extensions
    )

    for raw_path in raw_paths:
        if not raw_path.exists():
            continue
        try:
            stable, size, mtime = is_stable(raw_path, 0)
            if not stable:
                return None
            raw_row = upsert_seen_file(conn, source, raw_path, size, mtime)
            sha = raw_row["sha256"] or sha256_file(raw_path)
            mark_file(conn, raw_row["id"], sha256=sha, state="raw_retained")
            return {
                "raw_available": True,
                "raw_worker_file_id": raw_row["id"],
                "raw_filename": raw_path.name,
                "raw_extension": raw_path.suffix.lower(),
                "raw_sha256": sha,
                "raw_size_bytes": size,
                "raw_mtime": mtime,
                "pair_key": raw_row["pair_key"],
            }
        except Exception as exc:
            print(f"[{source.name}] RAW pair check failed for {raw_path}: {exc}")
            return None

    return None


def upload_file(config: WorkerConfig, source: SourceConfig, file_row: sqlite3.Row, path: Path, sha: str, raw_pair: dict[str, Any] | None = None) -> dict[str, Any]:
    content_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    fields = {
        "sha256": sha,
        "original_filename": path.name,
        "captured_at": "",
        "photo_role": "other",
        "idempotency_key": f"{source.name}:{sha}",
        "worker_version": WORKER_VERSION,
    }
    if raw_pair:
        fields["raw_metadata"] = json.dumps(raw_pair, separators=(",", ":"))

    body, boundary = multipart_body(
        fields,
        "file",
        path,
        content_type,
    )
    req = urlrequest.Request(
        f"{config.app_url}/api/v1/photo-ingest",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {source.token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )

    try:
        with urlrequest.urlopen(req, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {raw}") from exc
    except URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc

    data = json.loads(raw or "{}")
    if not data.get("ok"):
        raise RuntimeError(data.get("message") or data.get("error") or "Upload failed.")
    return data


def scan_source(config: WorkerConfig, conn: sqlite3.Connection, source: SourceConfig) -> None:
    if not source.watch_folder.exists():
        print(f"[{source.name}] folder unavailable: {source.watch_folder}")
        return

    ignored_roots = {
        source.watch_folder / "loopbase-processed",
    }
    if source.processed_folder:
        ignored_roots.add(source.processed_folder)
    if source.trash_folder:
        ignored_roots.add(source.trash_folder)

    resolved_ignored_roots = set()
    for ignored_root in ignored_roots:
        try:
            resolved_ignored_roots.add(ignored_root.resolve())
        except OSError:
            continue

    for root, dirs, filenames in os.walk(source.watch_folder):
        root_path = Path(root)
        try:
            resolved_root = root_path.resolve()
        except OSError:
            continue

        if any(resolved_root == ignored or ignored in resolved_root.parents for ignored in resolved_ignored_roots):
            dirs[:] = []
            continue

        kept_dirs = []
        for dirname in dirs:
            child = root_path / dirname
            try:
                resolved_child = child.resolve()
            except OSError:
                continue
            if any(resolved_child == ignored or ignored in resolved_child.parents for ignored in resolved_ignored_roots):
                continue
            kept_dirs.append(dirname)
        dirs[:] = kept_dirs

        for filename in filenames:
            path = Path(root) / filename
            suffix = path.suffix.lower()
            if suffix in source.raw_extensions:
                try:
                    stable, size, mtime = is_stable(path, config.stable_seconds)
                    if stable:
                        row = upsert_seen_file(conn, source, path, size, mtime)
                        if not row["sha256"]:
                            mark_file(conn, row["id"], sha256=sha256_file(path), state="raw_retained")
                except Exception as exc:
                    print(f"[{source.name}] RAW record failed for {path}: {exc}")
                continue

            if suffix not in source.extensions:
                continue

            try:
                stable, size, mtime = is_stable(path, config.stable_seconds)
                if not stable:
                    continue

                row = upsert_seen_file(conn, source, path, size, mtime)
                if row["state"] == "uploaded":
                    continue
                if int(row["attempts"]) >= config.max_upload_attempts:
                    continue

                sha = row["sha256"] or sha256_file(path)
                raw_pair = find_raw_pair(conn, source, path)
                mark_file(conn, row["id"], sha256=sha, state="uploading")
                result = upload_file(config, source, row, path, sha, raw_pair)
                capture = result.get("capture") or {}
                item_image = result.get("item_image") or {}
                mark_file(
                    conn,
                    row["id"],
                    state="uploaded",
                    attempts=int(row["attempts"]) + 1,
                    last_error="",
                    remote_capture_id=capture.get("id"),
                    remote_item_image_id=item_image.get("id") or capture.get("item_image_id"),
                    uploaded_at=time.time(),
                )
                if raw_pair and raw_pair.get("raw_worker_file_id") and capture.get("id"):
                    mark_file(
                        conn,
                        str(raw_pair["raw_worker_file_id"]),
                        paired_remote_capture_id=capture.get("id"),
                    )
                print(f"[{source.name}] uploaded {path.name} sha={sha[:12]}")
            except Exception as exc:
                existing = conn.execute(
                    "select * from files where source_name = ? and path = ?",
                    (source.name, str(path)),
                ).fetchone()
                if existing:
                    mark_file(
                        conn,
                        existing["id"],
                        state="failed",
                        attempts=int(existing["attempts"]) + 1,
                        last_error=str(exc),
                    )
                print(f"[{source.name}] upload failed for {path}: {exc}")


def run_worker(config: WorkerConfig) -> None:
    stop = False

    def handle_stop(_signum: int, _frame: Any) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, handle_stop)
    signal.signal(signal.SIGTERM, handle_stop)

    conn = connect_db(config.database_path)
    print(f"Photo ingest worker {WORKER_VERSION}")
    print(f"App URL: {config.app_url}")
    print(f"SQLite: {config.database_path}")
    for source in config.sources:
        print(f"Source: {source.name} -> {source.watch_folder}")

    while not stop:
        for source in config.sources:
            scan_source(config, conn, source)
            poll_worker_commands(config, conn, source)
            poll_processing_jobs(config, conn, source)
        time.sleep(config.scan_interval_seconds)

    conn.close()
    print("Photo ingest worker stopped.")


def choose_folder_dialog(initial_dir: str = "") -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(
            title="Choose Loopbase photo watch folder",
            initialdir=initial_dir if initial_dir and Path(initial_dir).exists() else None,
        )
        root.destroy()
        return selected or ""
    except Exception as exc:
        raise RuntimeError(f"Folder picker failed: {exc}") from exc


def render_setup_page(config_path: Path, data: dict[str, Any], message: str = "") -> bytes:
    sources = data.get("sources") if isinstance(data.get("sources"), list) else []
    rows = []
    if not sources:
        sources = [{
            "name": "",
            "token": "",
            "watch_folder": "",
            "processed_folder": "",
            "trash_folder": "",
            "extensions": [".jpg", ".jpeg"],
            "raw_extensions": [".nef", ".arw", ".cr2", ".cr3", ".raf", ".dng"],
        }]

    for index, source in enumerate(sources):
        name = html.escape(text(source.get("name")))
        token = html.escape(text(source.get("token")))
        folder = html.escape(text(source.get("watch_folder")))
        processed_folder = html.escape(text(source.get("processed_folder")))
        trash_folder = html.escape(text(source.get("trash_folder")))
        extensions = html.escape(", ".join(source.get("extensions") or [".jpg", ".jpeg"]))
        raw_extensions = html.escape(", ".join(source.get("raw_extensions") or [".nef", ".arw", ".cr2", ".cr3", ".raf", ".dng"]))
        rows.append(
            f"""
            <section class="source">
              <div class="source-title">Source {index + 1}</div>
              <label>Name<input name="source_{index}_name" value="{name}" placeholder="Nikon Incoming"></label>
              <label>Source token<input name="source_{index}_token" value="{token}" placeholder="phsrc_live_..."></label>
              <label>Watch folder
                <div class="folder-row">
                  <input id="folder_{index}" name="source_{index}_watch_folder" value="{folder}" placeholder="C:\\Photography\\Incoming">
                  <button type="button" onclick="chooseFolder({index})">Choose Folder</button>
                  <button type="button" onclick="createFolderFrom('folder_{index}')">Create</button>
                </div>
              </label>
              <label>Processed folder
                <div class="folder-row">
                  <input id="processed_{index}" name="source_{index}_processed_folder" value="{processed_folder}" placeholder="C:\\Photography\\Processed">
                  <button type="button" onclick="chooseFolderInto('processed_{index}')">Choose Folder</button>
                  <button type="button" onclick="createFolderFrom('processed_{index}')">Create</button>
                </div>
              </label>
              <label>Trash folder
                <div class="folder-row">
                  <input id="trash_{index}" name="source_{index}_trash_folder" value="{trash_folder}" placeholder="C:\\Photography\\Trash">
                  <button type="button" onclick="chooseFolderInto('trash_{index}')">Choose Folder</button>
                  <button type="button" onclick="createFolderFrom('trash_{index}')">Create</button>
                </div>
              </label>
              <label>JPEG upload extensions<input name="source_{index}_extensions" value="{extensions}" placeholder=".jpg, .jpeg"></label>
              <label>RAW retain/pair extensions<input name="source_{index}_raw_extensions" value="{raw_extensions}" placeholder=".nef, .arw, .cr2, .cr3, .raf, .dng"></label>
            </section>
            """
        )

    app_url = html.escape(text(data.get("app_url") or "http://localhost:3000"))
    database_path = html.escape(text(data.get("database_path") or "photo_ingest_worker.sqlite3"))
    scan_interval = html.escape(text(data.get("scan_interval_seconds") or "2"))
    stable_seconds = html.escape(text(data.get("stable_seconds") or "3"))
    max_attempts = html.escape(text(data.get("max_upload_attempts") or "20"))
    enable_processing_jobs = data.get("enable_processing_jobs") is True
    safe_message = html.escape(message)

    page = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loopbase Photo Worker Setup</title>
  <style>
    body {{
      margin: 0;
      background: #09090b;
      color: white;
      font-family: Arial, sans-serif;
    }}
    main {{
      max-width: 980px;
      margin: 0 auto;
      padding: 24px;
    }}
    header {{
      background: #000;
      border-radius: 18px;
      padding: 18px;
      margin-bottom: 16px;
    }}
    h1 {{ margin: 0; font-size: 28px; }}
    p {{ color: #a1a1aa; font-weight: 700; }}
    form, .source {{
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 12px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }}
    label {{
      display: block;
      color: #d4d4d8;
      font-size: 12px;
      font-weight: 900;
      margin-bottom: 10px;
    }}
    input {{
      box-sizing: border-box;
      margin-top: 6px;
      width: 100%;
      height: 40px;
      border: 1px solid #3f3f46;
      border-radius: 10px;
      background: #000;
      color: white;
      padding: 0 12px;
      font-weight: 800;
    }}
    .checkbox {{
      display: flex;
      align-items: center;
      gap: 10px;
      height: 40px;
      margin-top: 18px;
    }}
    .checkbox input {{
      margin: 0;
      width: 18px;
      height: 18px;
    }}
    button, .button {{
      border: 0;
      border-radius: 10px;
      background: #059669;
      color: white;
      height: 40px;
      padding: 0 14px;
      font-weight: 900;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }}
    .secondary {{ background: #27272a; }}
    .folder-row {{
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 8px;
    }}
    .source-title {{
      font-size: 16px;
      font-weight: 900;
      margin-bottom: 10px;
    }}
    .message {{
      border: 1px solid #a16207;
      background: #422006;
      color: #fef3c7;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 12px;
      font-weight: 900;
    }}
    code {{
      background: #000;
      border: 1px solid #27272a;
      padding: 2px 5px;
      border-radius: 5px;
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Loopbase Photo Worker Setup</h1>
      <p>Configure local watched folders for this photography PC. Config file: <code>{html.escape(str(config_path))}</code></p>
    </header>

    {f'<div class="message">{safe_message}</div>' if safe_message else ''}

    <form method="post" action="/save">
      <div class="grid">
        <label>App URL<input name="app_url" value="{app_url}"></label>
        <label>SQLite database path<input name="database_path" value="{database_path}"></label>
        <label>Scan interval seconds<input name="scan_interval_seconds" value="{scan_interval}"></label>
        <label>Stable seconds<input name="stable_seconds" value="{stable_seconds}"></label>
        <label>Max upload attempts<input name="max_upload_attempts" value="{max_attempts}"></label>
        <label class="checkbox">
          <input type="checkbox" name="enable_processing_jobs" value="true" {'checked' if enable_processing_jobs else ''}>
          Enable processing jobs
        </label>
      </div>

      {''.join(rows)}

      <input type="hidden" name="source_count" value="{len(sources)}">
      <button type="submit">Save Config</button>
      <a class="button secondary" href="/add-source">Add Source</a>
    </form>
  </main>
  <script>
    async function chooseFolder(index) {{
      const current = document.getElementById('folder_' + index).value;
      const res = await fetch('/choose-folder?current=' + encodeURIComponent(current));
      const data = await res.json();
      if (data.ok && data.path) {{
        document.getElementById('folder_' + index).value = data.path;
      }} else if (data.message) {{
        alert(data.message);
      }}
    }}
    async function chooseFolderInto(id) {{
      const input = document.getElementById(id);
      const res = await fetch('/choose-folder?current=' + encodeURIComponent(input.value));
      const data = await res.json();
      if (data.ok && data.path) {{
        input.value = data.path;
      }} else if (data.message) {{
        alert(data.message);
      }}
    }}
    async function createFolderFrom(id) {{
      const input = document.getElementById(id);
      const path = input.value.trim();
      if (!path) {{
        alert('Enter a folder path first.');
        return;
      }}
      if (!confirm('Create this folder if it does not exist?\\n\\n' + path)) return;
      const res = await fetch('/create-folder', {{
        method: 'POST',
        headers: {{ 'content-type': 'application/json' }},
        body: JSON.stringify({{ path }})
      }});
      const data = await res.json();
      if (data.ok) {{
        alert('Folder ready.');
      }} else {{
        alert(data.message || 'Could not create folder.');
      }}
    }}
  </script>
</body>
</html>"""
    return page.encode("utf-8")


def parse_setup_form(raw: bytes) -> dict[str, str]:
    parsed = parse_qs(raw.decode("utf-8"), keep_blank_values=True)
    return {key: values[-1] if values else "" for key, values in parsed.items()}


def form_to_config(form: dict[str, str]) -> dict[str, Any]:
    source_count = int(form.get("source_count") or 0)
    sources: list[dict[str, Any]] = []
    for index in range(source_count):
        name = text(form.get(f"source_{index}_name"))
        token = text(form.get(f"source_{index}_token"))
        folder = text(form.get(f"source_{index}_watch_folder"))
        processed_folder = text(form.get(f"source_{index}_processed_folder"))
        trash_folder = text(form.get(f"source_{index}_trash_folder"))
        extensions = [
            ext.strip() if ext.strip().startswith(".") else f".{ext.strip()}"
            for ext in text(form.get(f"source_{index}_extensions")).split(",")
            if ext.strip()
        ]
        raw_extensions = [
            ext.strip() if ext.strip().startswith(".") else f".{ext.strip()}"
            for ext in text(form.get(f"source_{index}_raw_extensions")).split(",")
            if ext.strip()
        ]
        if not name and not token and not folder:
            continue
        sources.append(
            {
                "name": name,
                "token": token,
                "watch_folder": folder,
                "processed_folder": processed_folder,
                "trash_folder": trash_folder,
                "extensions": extensions or [".jpg", ".jpeg"],
                "raw_extensions": raw_extensions or [".nef", ".arw", ".cr2", ".cr3", ".raf", ".dng"],
            }
        )

    return {
        "app_url": text(form.get("app_url")) or "http://localhost:3000",
        "database_path": text(form.get("database_path")) or "photo_ingest_worker.sqlite3",
        "scan_interval_seconds": float(form.get("scan_interval_seconds") or 2),
        "stable_seconds": float(form.get("stable_seconds") or 3),
        "max_upload_attempts": int(form.get("max_upload_attempts") or 20),
        "enable_processing_jobs": text(form.get("enable_processing_jobs")).lower() == "true",
        "sources": sources,
    }


def make_setup_handler(config_path: Path):
    class SetupHandler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, content_type: str = "text/html; charset=utf-8") -> None:
            self.send_response(status)
            self.send_header("content-type", content_type)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _redirect(self, location: str) -> None:
            self.send_response(303)
            self.send_header("location", location)
            self.end_headers()

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            data = load_config_json(config_path)

            if parsed.path == "/":
                message = text(parse_qs(parsed.query).get("message", [""])[0])
                data = apply_setup_prefill(data, parsed.query)
                self._send(200, render_setup_page(config_path, data, message))
                return

            if parsed.path == "/add-source":
                sources = data.get("sources") if isinstance(data.get("sources"), list) else []
                sources.append({
                    "name": "",
                    "token": "",
                    "watch_folder": "",
                    "processed_folder": "",
                    "trash_folder": "",
                    "extensions": [".jpg", ".jpeg"],
                    "raw_extensions": [".nef", ".arw", ".cr2", ".cr3", ".raf", ".dng"],
                })
                data["sources"] = sources
                save_config_json(config_path, data)
                self._redirect("/")
                return

            if parsed.path == "/choose-folder":
                current = text(parse_qs(parsed.query).get("current", [""])[0])
                try:
                    selected = choose_folder_dialog(current)
                    payload = {"ok": True, "path": selected}
                except Exception as exc:
                    payload = {"ok": False, "message": str(exc)}
                self._send(200, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")
                return

            self._send(404, b"Not found")

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/create-folder":
                length = int(self.headers.get("content-length") or 0)
                try:
                    payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                    folder = Path(text(payload.get("path")))
                    if not folder:
                        raise RuntimeError("Folder path is required.")
                    folder.mkdir(parents=True, exist_ok=True)
                    self._send(200, json.dumps({"ok": True, "path": str(folder)}).encode("utf-8"), "application/json; charset=utf-8")
                except Exception as exc:
                    self._send(400, json.dumps({"ok": False, "message": str(exc)}).encode("utf-8"), "application/json; charset=utf-8")
                return

            if parsed.path != "/save":
                self._send(404, b"Not found")
                return

            length = int(self.headers.get("content-length") or 0)
            form = parse_setup_form(self.rfile.read(length))
            data = form_to_config(form)
            save_config_json(config_path, data)
            self._redirect("/?message=Config%20saved")

    return SetupHandler


def run_setup_server(config_path: Path, host: str, port: int) -> None:
    server = ThreadingHTTPServer((host, port), make_setup_handler(config_path))
    print(f"Photo worker setup listening on http://{host}:{port}")
    print(f"Config file: {config_path}")
    print("Press Ctrl+C to stop setup server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Loopbase photo ingest worker")
    parser.add_argument("--config", default="config.local.json", help="Path to JSON config")
    parser.add_argument("--setup", action="store_true", help="Run local browser setup UI")
    parser.add_argument("--setup-host", default="127.0.0.1", help="Setup UI host")
    parser.add_argument("--setup-port", type=int, default=8780, help="Setup UI port")
    args = parser.parse_args()

    try:
        config_path = Path(args.config)
        if args.setup:
            run_setup_server(config_path, args.setup_host, args.setup_port)
            return 0

        config = load_config(config_path)
        run_worker(config)
        return 0
    except Exception as exc:
        print(f"Worker failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
