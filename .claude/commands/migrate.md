---
description: Run Alembic migrations to latest revision
---

Apply all pending Alembic migrations against `data/pinch.db`.

```bash
cd backend && .venv/Scripts/python.exe -m alembic upgrade head
```

To create a new migration: `.venv/Scripts/python.exe -m alembic revision -m "describe change"`.
To roll back one revision: `.venv/Scripts/python.exe -m alembic downgrade -1`.
