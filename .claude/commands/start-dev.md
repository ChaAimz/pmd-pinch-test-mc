---
description: Start FastAPI backend in mock-mode with auto-reload
---

Boot the FastAPI backend with mock hardware (`mock_mode: true` in `backend/config.yaml`). Hot-reload on save. OpenAPI explorer at http://localhost:8000/docs.

```bash
cd backend && .venv/Scripts/uvicorn app.main:app --reload --port 8000
```

If `config.yaml` is missing, copy from example: `cp config.example.yaml config.yaml`. Then re-run.
