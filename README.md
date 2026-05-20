# Pinch Test Machine

Web application controlling a pinch test rig (Keyence PLC + Imada force gauge + ESP32 clamp force sensor).

See [docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md](docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md) for the design.

## Backend (Plan 1 — mock-driven E2E)

```
cd backend
python -m venv .venv && .venv\Scripts\activate    # Windows
pip install -e .[dev]
cp config.example.yaml config.yaml
alembic upgrade head
uvicorn app.main:app --reload
```

Visit `http://localhost:8000/docs` for the OpenAPI explorer.

### Tests

```
cd backend
pytest -v
```

### Mock mode

`config.yaml: mock_mode: true` (default in example) — the app boots with simulated PLC/Imada/ESP32 so it runs on any developer machine.

## Plans

- [Plan 1 — Backend Foundation + Mock E2E](docs/superpowers/plans/2026-05-19-plan-1-backend-mock-e2e.md)
- Plan 2 — Frontend (Vite + ShadcnUI)
- Plan 3 — Real hardware drivers
- Plan 4 — History + Hardware + Settings + Calibration UI
