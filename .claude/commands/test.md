---
description: Run the backend pytest suite with verbose output
---

Run the full backend test suite from the project venv. Pass any extra args after `/test` to forward to pytest (e.g. `/test -k recipe`).

```bash
cd backend && .venv/Scripts/python.exe -m pytest -v $ARGUMENTS
```

If pytest is not yet installed, run `pip install -e ".[dev]"` from `backend/` first.
