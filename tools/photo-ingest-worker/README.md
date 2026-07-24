# Photo ingest worker

Local worker for photography stations. It watches one or more local/NAS folders and uploads stable image files to Loopbase through:

```text
POST /api/v1/photo-ingest
```

The worker uses a per-source token. It never uses Supabase service-role keys, database passwords, or tenant admin credentials.

## Recommended setup without editing JSON

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\photo-ingest-worker"

& "C:\Users\David's Laptop\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\photo_ingest_worker.py --setup --config .\config.local.json
```

Then open:

```text
http://127.0.0.1:8780
```

The local setup page lets you:

- enter the Loopbase app URL
- paste the source token from Photo Monitor
- choose the watched folder with a Windows folder picker
- optionally choose processed/trash folders for safe local source-file commands
- keep JPEG upload extensions and RAW pair/retain extensions separate
- save `config.local.json`

The cloud app never stores or controls the local/NAS folder path.

After creating or rotating a source token in Photo Monitor, use **Open Worker Setup With Token**. It opens the local setup page with the app URL, source name, and token prefilled. You still choose the local/NAS folder on the worker PC and click **Save Config**.

## Run worker after setup

Keep Loopbase running in one PowerShell window, then run the worker in another:

```powershell
cd "C:\Users\David's Laptop\Documents\Codex\2026-05-24\ok-are-you-connected-to-my\dohpe-stock\tools\photo-ingest-worker"

& "C:\Users\David's Laptop\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\photo_ingest_worker.py --config .\config.local.json
```

## Optional processing engines

Install these on the photo station if you want queued processing jobs to run locally:

```powershell
& "C:\Users\David's Laptop\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m pip install -r .\requirements-processing.txt
```

Supported local engines:

- Pillow: processed/calibrated preview output, EXIF orientation and resizing.
- rembg: background removal output.
- OpenCV ArUco: marker detection metadata for measurement/calibration jobs.
- rawpy: RAW development preview from paired local RAW files.

## Manual config fallback

You can still create/edit `config.local.json` manually if needed.

Create sources from the Photo Monitor. Each source gives you a token once. Put that token in the matching config source.

```json
{
  "app_url": "http://localhost:3000",
  "database_path": "photo_ingest_worker.sqlite3",
  "scan_interval_seconds": 2,
  "stable_seconds": 3,
  "sources": [
    {
      "name": "Nikon Incoming",
      "token": "phsrc_live_replace_me",
      "watch_folder": "C:\\Photography\\Nikon\\Incoming",
      "processed_folder": "C:\\Photography\\Nikon\\Processed",
      "trash_folder": "C:\\Photography\\Nikon\\Trash",
      "extensions": [".jpg", ".jpeg"],
      "raw_extensions": [".nef", ".arw", ".cr2", ".cr3", ".raf", ".dng"]
    }
  ]
}
```

For Loopbase production, use:

```json
"app_url": "https://loopbase.io"
```

## What it does now

- Scans configured folders repeatedly.
- Waits for files to be stable before upload.
- Hashes files with SHA-256.
- Stores local file/upload state in SQLite.
- Retries failed uploads.
- Uploads JPEG files to the active station session through the source token.
- Detects paired RAW files with the same folder/basename, e.g. `DSC_1001.JPG` + `DSC_1001.NEF`.
- Keeps RAW files local by default and sends only RAW metadata to Loopbase.
- Polls for safe worker commands tied to known uploaded capture records.
- Can delete or move known local JPEG source files and paired RAW files when the source policy asks for it.
- Polls Loopbase photo processing jobs and runs installed local processors.

## What it does not do yet

- It does not create garment measurement values yet. ArUco detection records reference metadata only until measurement-line/edge rules are defined.
- It does not apply true Calibrite colour transforms yet. Calibrite profile data is stored for the future colour pipeline.

Those should be added after the basic ingest flow is proven with a real camera folder.
