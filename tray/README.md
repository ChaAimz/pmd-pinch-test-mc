# Pinch Test Machine -- System Tray Manager

## Architecture

| Component | How it runs | URL |
|-----------|-------------|-----|
| Backend (FastAPI + uvicorn) | Native Windows process, managed by tray app | http://127.0.0.1:8000 |
| Frontend (React + nginx) | Docker container (`pinch-frontend:latest`, `restart: always`) | http://localhost:8080 |
| Kiosk | Edge `--kiosk` fullscreen, pointed at :8080 | http://localhost:8080 |

The backend must run natively because it owns:
- COM ports (Imada force gauge, ESP32 clamp sensor)
- USB connection to the KV-3000 PLC via the 32-bit `plc_bridge.py` subprocess

The frontend runs in Docker so it can be served from a pre-built nginx image without
Node.js/npm on the operator PC.

## Standalone installation (C:\pinch-test-mc)

The production installation lives entirely under `C:\pinch-test-mc\` and does NOT
depend on the git repo at runtime.  After assembly the repo can be deleted.

```
C:\pinch-test-mc\
  pinch-tray.exe          System-tray manager (PyInstaller onefile, windowed)
  pinch-tray.ini          Path config (backend_dir, compose_file)
  docker-compose.yml      Image-only compose file (no build: context)
  backend\
    app\                  FastAPI source package
    .venv\                Self-contained Python venv (created at destination)
    py32\                 32-bit Python embed + plc_bridge.py
    plc_bridge.py
    alembic.ini
    pyproject.toml
    config.yaml
    logs\
      tray.log            Tray app log (5 MB rotating, 3 backups)
      app.log             Backend log
  data\
    pinch.db              SQLite database
    waveforms\            Parquet waveform files
  install_autostart.ps1
  uninstall_autostart.ps1
  README.md
```

## External prerequisites (NOT bundled)

These must be present on the operator PC before the app can run:

1. **Docker Desktop** -- install via winget:
   ```powershell
   winget install -e --id Docker.DockerDesktop
   ```
   After install: open Docker Desktop, accept the licence, enable WSL2 engine, then
   tick **Settings > General > Start Docker Desktop when you log in**.
   The `restart: always` in `docker-compose.yml` will bring the container back
   automatically when Docker starts.

2. **KEYENCE KVComPlus** (32-bit DLL) at:
   `C:\Program Files (x86)\KEYENCE\KVComPlusLB\bin\DataBuilder.dll`
   Required only for PLC communication (`mock_mode: false`).

3. **Microsoft Edge** -- standard Windows install (already present on Windows 10/11).

## One-time assembly (run from repo, before deleting it)

```powershell
# From the repo root, with Docker Desktop running:
powershell -File tray\assemble-standalone.ps1
```

This script:
1. Copies `backend\app\`, `py32\`, `plc_bridge.py`, `alembic.ini`, `pyproject.toml` to `C:\pinch-test-mc\backend\`
2. Creates a **fresh venv** at `C:\pinch-test-mc\backend\.venv\` using the system Python
3. Runs `alembic upgrade head` in the standalone backend
4. Builds the `pinch-frontend:latest` Docker image from the repo
5. Writes a standalone `docker-compose.yml` (image-only, no build: context)
6. Builds `pinch-tray.exe` via PyInstaller into `C:\pinch-test-mc\`
7. Writes `pinch-tray.ini`, copies `install_autostart.ps1` / `uninstall_autostart.ps1`

If Docker or PyInstaller fails during assembly, see the **Manual steps** section below.

## Enable auto-start

```powershell
powershell -File C:\pinch-test-mc\install_autostart.ps1
```

This places a shortcut to `pinch-tray.exe` in `shell:startup` and removes any
old `start-pinch*.bat` / `start-pinch*.lnk` shortcuts.

To remove auto-start:
```powershell
powershell -File C:\pinch-test-mc\uninstall_autostart.ps1
```

## Tray icon and menu

Right-click the tray icon for:

| Item | Action |
|------|--------|
| Status: ... | Shows current state (disabled, read-only) |
| Start | Launch the backend if it is not running |
| Stop | Kill the backend + plc_bridge child |
| Reset (stop + start) | Stop then restart the backend |
| Open Kiosk | Open Edge at http://localhost:8080 |
| Quit | Stop backend and exit the tray app |

Icon colours:
- **Green** -- backend healthy (HTTP 200 from `/api/recipes`)
- **Orange** -- starting or unhealthy
- **Red** -- stopped or error

## Relocating the backend directory

Edit `C:\pinch-test-mc\pinch-tray.ini`:

```ini
[pinch]
backend_dir  = D:\pinch-mc\backend
compose_file = D:\pinch-mc\docker-compose.yml
```

Or set environment variables `PINCH_BACKEND_DIR` / `PINCH_COMPOSE_FILE` before launching.

## pinch-tray.ini reference

```ini
[pinch]
; Directory containing app\, .venv\, py32\, config.yaml
backend_dir  = C:\pinch-test-mc\backend

; docker-compose.yml that manages the frontend container
compose_file = C:\pinch-test-mc\docker-compose.yml
```

## Rebuilding after frontend code changes

While the repo still exists:
```powershell
# Rebuild the docker image with the latest frontend code:
docker compose build frontend

# (Optional) Restart the container to pick up the new image:
docker compose up -d frontend
```

After the repo is deleted, frontend code changes require rebuilding from source
(reinstall procedure).

## start-pinch.bat (manual / dev fallback)

`start-pinch.bat` and `start-pinch-docker.bat` remain in the repo and continue to
work as manual / developer launchers.  They are NOT the production path; the tray
app replaces them in the Startup folder.  Do NOT delete `start-pinch.bat` -- it is
useful for diagnostics when the tray is not running.

## Troubleshooting

### Docker not running
The tray app will log a warning and skip `docker compose up`.  The frontend
container won't start.  Fix:
1. Open Docker Desktop and wait for it to show "Running".
2. Right-click the tray icon > **Reset** to retry.

### Bridge stuck (port 8000 in use / rc=4 from KVComPlus)
The tray's **Stop** kills the entire backend process tree including `plc_bridge.py`.
If a stray bridge is still listed (`tasklist | findstr plc_bridge`):
```powershell
# Kill manually:
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*plc_bridge*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
Then tray > **Start**.

### Port 8000 already in use
Another process may be using port 8000.  Check:
```powershell
netstat -ano | findstr :8000
```
Kill the offender, then tray > **Start**.

### Backend crashes immediately
Check `C:\pinch-test-mc\backend\logs\tray.log` (tray output) and
`C:\pinch-test-mc\backend\logs\app.log` (uvicorn/app output).
Common causes:
- `config.yaml` references a COM port that doesn't exist; set `mock_mode: true` to
  run without hardware.
- Missing alembic migration: `cd C:\pinch-test-mc\backend && .venv\Scripts\python -m alembic upgrade head`

### Kiosk shows blank page
The frontend container may not be up.  Check:
```powershell
docker ps
docker compose -f C:\pinch-test-mc\docker-compose.yml logs frontend
```
Bring it up:
```powershell
docker compose -f C:\pinch-test-mc\docker-compose.yml up -d frontend
```

## Manual build steps (if assemble-standalone.ps1 partially failed)

### Build PyInstaller exe manually
```powershell
cd <repo-root>
backend\.venv\Scripts\pip install -r tray\requirements.txt
backend\.venv\Scripts\python -m PyInstaller --noconfirm --distpath C:\pinch-test-mc tray\pinch_tray.spec
```

### Build Docker image manually
```powershell
cd <repo-root>
docker compose build frontend
```

### Create fresh destination venv manually
```powershell
python -m venv C:\pinch-test-mc\backend\.venv
C:\pinch-test-mc\backend\.venv\Scripts\pip install -e C:\pinch-test-mc\backend
cd C:\pinch-test-mc\backend
.venv\Scripts\python -m alembic upgrade head
```
