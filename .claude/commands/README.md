# Project Slash Commands

Project-scoped slash commands live here. Each command is a Markdown file with optional YAML frontmatter, e.g. `start-dev.md`:

```markdown
---
description: Start the FastAPI dev server with mock hardware
---

Run the backend uvicorn server in reload mode from `backend/` using the project venv.

```bash
cd backend && .venv/Scripts/uvicorn app.main:app --reload --port 8000
```

Then open http://localhost:8000/docs for the OpenAPI explorer.
```

Invoke from any session in this project as `/start-dev`.

## Suggested commands for this project

- `/start-dev` — boot backend with mock hardware
- `/migrate` — run `alembic upgrade head`
- `/test` — `pytest -v` from backend
- `/smoke` — `curl` the OpenAPI + a session lifecycle
- `/build-graph` — alias for `/graphify` constrained to `backend/app` and `docs/`

Drop new files in this folder to add more. Commit them when they should be shared with the team.
