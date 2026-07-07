# Pinch Test Machine

Web application controlling a pinch test rig (Keyence KV-3000 PLC + Imada ZTS force gauge + ESP32 clamp force sensor).

See [docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md](docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md) for the full design spec.

## Quick start (mock hardware — no physical devices needed)

```powershell
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
copy config.example.yaml config.yaml
python -m alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

```powershell
# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Backend OpenAPI explorer at `http://localhost:8000/docs`.

`config.yaml: mock_mode: true` (default) — runs with simulated PLC / Imada / ESP32.

## Running tests

```powershell
cd backend
pytest -v
```

## Implementation plans

| Plan | Status | Description |
|---|---|---|
| [Plan 1 — Backend Foundation + Mock E2E](docs/superpowers/plans/2026-05-19-plan-1-backend-mock-e2e.md) | Done | FastAPI backend, mock drivers, state machine, REST + WS APIs |
| [Plan 2 — Frontend](docs/superpowers/plans/2026-05-20-plan-2-frontend.md) | Done | Vite + React + ShadcnUI + uPlot operator UI |
| Plan 3 — Real hardware drivers | Partial | PLC (KVComPlus USB) done; Imada + ESP32 pending hardware |
| [Plan 4 — History + Hardware UI](docs/superpowers/plans/2026-05-20-plan-4-frontend-history-hardware.md) | Done | History list/detail, Hardware page, ESP32 calibration wizard |

## Production deployment (tray app)

The production launcher is **`tray/`** — a system-tray manager that replaces
`start-pinch-docker.bat` in the Windows Startup folder.

| Component | Runtime |
|-----------|---------|
| Backend (FastAPI :8000) | Native Windows process (COM ports + USB PLC) |
| Frontend (React :8080) | Docker container `pinch-frontend:latest` (`restart: always`) |
| Kiosk | Edge `--kiosk http://localhost:8080` |

One-time assembly (while the repo still exists):
```powershell
powershell -File tray\assemble-standalone.ps1
```
This copies the backend, builds the Docker image, creates a fresh venv at
`C:\pinch-test-mc\backend\.venv`, and produces `C:\pinch-test-mc\pinch-tray.exe`.
After assembly the repo can be deleted — the app runs entirely from `C:\pinch-test-mc\`.

See [`tray/README.md`](tray/README.md) for full instructions, troubleshooting, and
the `pinch-tray.ini` configuration reference.

`start-pinch.bat` and `start-pinch-docker.bat` remain as manual/dev fallbacks.

## PLC architecture (KVComPlus USB bridge)

The KV-3000 CPU RS-232C port speaks only Keyence's proprietary HMI protocol. We use USB + KVComPlus:

```
FastAPI (64-bit, :8000)
  │  HTTP :8765
  ▼
plc_bridge.py (32-bit Python → DataBuilder.dll → USB → KV-3000)
```

See CLAUDE.md for full architecture and hardware contracts.
