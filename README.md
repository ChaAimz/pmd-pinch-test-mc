# Pinch Test Machine

Web application controlling a pinch test rig (Keyence PLC + Imada force gauge + ESP32 clamp force sensor).

See [docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md](docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md) for the design.

## Quick start (development with mock hardware)

```
cd backend
uv sync                      # or: pip install -e .
cp config.example.yaml config.yaml   # mock_mode: true by default
alembic upgrade head
uvicorn app.main:app --reload
```

Tests: `cd backend && pytest`
