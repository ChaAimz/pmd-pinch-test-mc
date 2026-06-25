# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Web-based control & data-acquisition application for a **pinch test machine**. The system drives a Keyence PLC (KV-3000 or KV-LH20V via KV-Link protocol), reads a clamp force sensor (ESP32 + HX711 over RS232), and streams tensile force data from an Imada force gauge (RS232) into a real-time line chart. It manages test recipes, executes a stateful test loop (move → clamp → tension check → unclamp → repeat), and records summary metrics + raw waveforms.

**Deployment target:** single-machine local app on Windows. Backend + frontend both run on the operator's PC; the browser connects to `localhost`.

## Authoritative design docs

Always read these before changing architecture, protocols, or data shapes — they are the source of truth, not the code:

- Design spec: [docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md](docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md) — PLC bit/word map, state machine, hardware abstraction, DB schema, REST + WebSocket protocol, safety invariants.
- Implementation plan: [docs/superpowers/plans/2026-05-19-plan-1-backend-mock-e2e.md](docs/superpowers/plans/2026-05-19-plan-1-backend-mock-e2e.md) — 23 TDD tasks, all done (Phases A–C complete).

If you change a contract (PLC bit, REST payload, WS message shape), update the spec first, then the plan, then code.

## Architecture (must read before touching backend)

```
Browser  ──HTTP REST + WebSocket──▶  FastAPI (single process, :8000)
                                       │
   ┌───────────────────────────────────┼───────────────────────────────────┐
   ▼                                   ▼                                   ▼
 REST API                       Test Runner (asyncio task)          WebSocket hub
 (recipes, sessions,             drives state machine,              (fan-out events
  runs, hardware,                consumes hardware queues,            to clients)
  config)                        persists to SQLite + parquet
                                       ▲
                                       │ asyncio.Queue (bridge from threads)
                                       │
                              Hardware Manager
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
   PLC thread                    Imada thread                  ESP32 thread
   (KVComPlus USB                (pyserial,                    (pyserial,
    32-bit bridge)                polled RS232)                 continuous RS232)
        │                              │                              │
     [USB]                          [COM4]                         [COM5]
```

**Key invariant — read this before adding any I/O:**

- **pyserial is blocking. asyncio loop must never call it directly.** Each serial device runs in a worker thread; data crosses to asyncio via `asyncio.Queue` + `loop.call_soon_threadsafe`. Don't use `pyserial-asyncio` (unstable on Windows).
- Mock drivers (in `backend/app/hardware/mock/`) implement the same Protocol as real drivers — they swap in when `config.yaml: mock_mode: true`. Develop and run tests without hardware by keeping mock mode on. Plan 3 (partial) adds real drivers; PLC done, Imada/ESP32 pending.
- **WebSocket payloads use raw dicts**, not Pydantic dumps. State change messages use keys `from` and `to` (not `from_state`/`to_state`) — `from` is a Python keyword, so Pydantic schemas use `Field(alias="from")`.

## Commands

All Python commands assume venv activated. Run from `backend/`.

```powershell
# First-time setup
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
copy config.example.yaml config.yaml
python -m alembic upgrade head

# Dev server
uvicorn app.main:app --reload --port 8000      # OpenAPI explorer at http://localhost:8000/docs

# Tests
pytest                                          # full suite (uses pyproject's --basetemp=.pytest_tmp)
pytest tests/unit/test_recipe_service.py -v    # single file
pytest -k "create_and_get" -v                  # single test by name
pytest tests/integration/ -v                   # integration only

# Migrations
python -m alembic upgrade head                  # apply migrations
python -m alembic revision -m "add foo column"  # new migration
python -m alembic downgrade -1                  # rollback one step

# Lint
ruff check .
ruff format .
```

**Important — pytest temp dir:** `pyproject.toml` pins `addopts = "--basetemp=.pytest_tmp"` because the Windows default `%TEMP%\pytest-of-*` had a legacy deny ACL on this machine. Do not remove this line.

## Frontend commands

All frontend commands run from `frontend/`.

```powershell
npm install                  # first-time setup
npm run dev                  # dev server at http://localhost:5173
npm run build                # production build → frontend/dist/
npx vitest run               # unit tests (ws, stores)
npx playwright test          # E2E (both servers must be running)
```

## Repository layout (Phase A done; later phases incoming)

```
docs/
  superpowers/
    specs/   ← design (source of truth)
    plans/   ← TDD task lists
backend/
  alembic.ini
  pyproject.toml
  config.example.yaml      ← user copies to config.yaml (gitignored)
  app/
    main.py                ← FastAPI build_app() + uvicorn entry
    config.py              ← pydantic-settings + yaml loader
    logging_setup.py       ← loguru with daily rotation
    db/
      engine.py            ← init_engine / get_engine / get_session
      models.py            ← Recipe / TestRun / TestLoop (SQLModel)
      migrations/          ← alembic env + versions/
    api/
      recipes.py           ← /api/recipes CRUD
      (sessions, runs, hardware, config, ws — added in Phase C)
    services/
      recipe_service.py
      (state_machine, test_runner, waveform, event_bus, ws_hub — Phase B/C)
    hardware/              ← Phase B
      base.py              ← Protocols + dataclasses
      manager.py
      mock/                ← MockPlc / MockImada / MockEsp32
      (real drivers — Plan 3)
    schemas/
      recipe.py
      (session, run, hardware, ws_messages — Phase C)
  tests/
    unit/                  ← service / model / parser tests
    integration/           ← REST + WS tests using TestClient
data/                      ← gitignored: pinch.db + waveforms/<run_id>/loop_NNN.parquet
```

## Hardware contracts (PLC bit/word map)

Source of truth: spec §2. Quick reference:

| Bit | Direction | Meaning |
|---|---|---|
| B0 | Web → PLC | Start session (after writing DM28/DM30/DM32) |
| B1 | Web → PLC | Stop / E-Stop (top priority — bypasses queue) |
| B2 | Web → PLC | Reset |
| B3 (MR803) | PLC → Web | Press Clamp — PLC-driven; backend polls & waits for it (changed 2026-06-17) |
| B4 (MR804) | Web → PLC | Stop clamp actuator. Fires on recipe clamp force limit (normal) OR hardware limit `force_limit_gf` (always-on safety → M/C Stop + Reset + "Clamp Force Sensor Alarm" dialog → ERROR) |
| B5 | PLC → Web | Start tension check |
| B6 | PLC → Web | End tension check |
| B7 | PLC → Web | Finish process |
| MR811 | PLC → Web | Max Stroke of Clamp — safety warning; shows "Max Stroke of Clamp Reached" dialog when HIGH, auto-clears when LOW |
| MR812 | PLC → Web | Tare Imada (force gauge) — when HIGH, backend sends zero/tare command to Imada; separate from MR808 (ESP32 clamp tare) |

| DM register | Direction | Meaning |
|---|---|---|
| DM28 | Web → PLC | Loop count |
| DM30 | Web → PLC | Actuator 1 position (mm × 100) |
| DM32 | Web → PLC | Actuator 1 speed (mm/s × 100) |
| DM10 | Web → PLC | Heartbeat — Python increments every 200 ms |

## Conventions & gotchas

- **Recipe judgment** (`pass`/`fail` of a tension check): defined in spec §4 EVALUATE — `pass` iff `min ≤ peak ≤ max` AND `hold_time ≥ recipe.hold_time_ms`. Each `None` field disables that check. Don't reinvent this; reuse `WaveformService.summarize()` once it exists (Plan 1 Task 13).
- **Imada unit:** parser drops samples whose unit isn't `N` (do not auto-convert). The Imada ZTS unit must be set to N on the device.
- **ESP32 calibration** is `force_n = (raw - offset) * slope`. Two-point fit: `slope = known_force / (raw_known - raw_zero)`, `offset = raw_zero`. Live in `config.yaml: hardware.esp32.calibration`; updated via `/api/hardware/esp32/calibrate` (Phase C).
- **State machine timeouts are mandatory.** Every state waits with a timeout from `config.yaml: hardware.state_timeouts`. No state waits for a PLC bit forever.
- **Settings save is rejected while a session is running.** Operator must Stop or wait for B7 before applying changes (spec §9.6).
- **WebSocket backpressure:** drop oldest sample batch if a client lags; raw data is in parquet so live UI prefers freshness over completeness.

## Workflow rules (orchestration model)

This repo follows the user's global orchestration model in `~/.claude/CLAUDE.md`:

| Worker | Use when |
|---|---|
| `/codex:rescue` | Implement, fix bug, refactor across multiple files. Uses OpenAI token pool. |
| `Agent(subagent_type=Explore)` | Search the codebase across many files (read-only). |
| `Agent(subagent_type=Plan)` | Design implementation strategy before touching code. |
| `mcp__playwright__*` | Test the UI in a real browser (Phase 2 onwards). |
| `mcp__plugin_context7_context7__*` | Library docs lookup (fastapi, sqlmodel, pyarrow…). |
| `/review` | Pre-merge review. |

**Heuristic:** task > 3 steps or touches > 3 files → hand off to a worker. Keep Claude in orchestrator mode.

**Notes on the Codex sandbox seen on this machine:**

- `pip install` is blocked inside the Codex sandbox; the project venv lives outside the sandbox at `backend/.venv` and must be created/maintained by the Aimz user account. If Codex starts shimming `loguru.py` or `sqlmodel/`, stop and re-run the dependency install yourself.
- The Codex sandbox cannot write to `.git/` (deny ACL). If commits are needed during Codex tasks, finish the edits inside Codex and commit from the Aimz shell afterwards.

## Project agents

Project-scoped agents live in `.claude/agents/`. Invoke with `Agent(subagent_type="<slug>")`.

| Slug | Nickname | Best for |
|---|---|---|
| `george` | ไอ้จอร์จ | PLC / KV-Link / serial drivers / `pyserial` threading / Python device connection |
| `pi-front` | พี่ Front | Vite + React + ShadcnUI operator UI / uPlot real-time chart / WebSocket client |
| `black` | ไอ้แบล็ค | Backend polyglot — Python/Java/Node, FastAPI services, REST/WS contracts, cross-stack integration |
| `database` | ไอ้ต้า | Schema design, Alembic migrations, query plans, time-series storage choices |
| `devops` | ไอ้ออฟ | CI/CD, Windows service hosting (NSSM), packaging, lockfiles, single-machine deployment |
| `qa` | ไอ้คิว | pytest design, Playwright E2E, hardware-in-loop checklists, regression tests |
| `docs` | พี่ดอก | README/CLAUDE.md/spec/plan upkeep, Mermaid diagrams, changelog, commit-message coaching |

When delegating, write a self-contained prompt — agents don't see this conversation. Include the spec/plan section the work touches (`docs/superpowers/specs/...md §6`, etc.).

### Routing rule (Codex vs Sonnet)

- **Bulk / repetitive / mechanical work** (apply the same change across many files, scaffolding a known pattern, mass renames, boilerplate generation) → hand to `/codex:rescue`. It's cheaper and reserves Claude tokens for thinking work.
- **Judgment-heavy work** (architecture decisions, contract design, ambiguous bug triage, risk review, anything where being wrong is expensive) → keep on Sonnet (these project agents, or Claude inline). Don't outsource judgment to Codex.

A useful rule of thumb: if you can describe the task with "do X to each Y in Z" and a fresh dev would handle it the same way, it's a Codex job. If the task asks "should we do X, or maybe Y, given Z?", it stays on Sonnet.

If using `/codex:rescue` in this repo, remember the sandbox limits from the *Workflow rules* section above (no pip, no `.git` writes) — give Codex tasks that don't need new dependencies or git commits.

## /graphify

The `graphify` skill (global: `~/.claude/skills/graphify/SKILL.md`) turns any input (code, docs, papers, images) into a knowledge graph → clustered communities → HTML + JSON + audit report.

- **Trigger:** when the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` **before doing anything else**.
- **Good fits in this repo:** mapping the state machine + event flow, visualising the dependency tree of `app/services/`, or comparing the spec's stated contracts against the implemented code.
- Do not pre-invoke graphify for unrelated tasks. It's user-triggered only.

## Current status (2026-05-29)

- ✅ **Plan 1, Phase A (Tasks 1–6)** — Skeleton, config, logging, DB models, alembic migrations, recipe CRUD + REST.
- ✅ **Plan 1, Phase B (Tasks 7–14)** — Hardware base + 3 mock drivers + async event bus + state machine + waveform (parquet) + HardwareManager.
- ✅ **Plan 1, Phase C (Tasks 15–23)** — WS hub, deps, TestRunner, sessions/runs/hardware/config APIs, README. `pytest` 39/39 passing.
- ✅ **Plan 2** — Frontend: Vite + React + ShadcnUI + uPlot. Recipes CRUD, Run page, TopBar (clock + device status), sidebar dark mode. Live WS connected.
- 🟡 **Plan 3** — Real PLC driver done via **KVComPlus over USB** (32-bit bridge subprocess + 64-bit RealPlc client). Imada (COM4) + ESP32 drivers still pending hardware.
- ✅ **Plan 4** — History list + detail (uPlot per-loop waveform + CSV export), Hardware page (live status + reconnect + ESP32 calibration wizard), fixed session API endpoints, App routes wired.

## PLC architecture (Plan 3 — DO NOT REVERT)

After extensive testing on 2026-05-22, the KV-3000 CPU's built-in RS-232C port was confirmed to speak only Keyence's proprietary HMI protocol (binary BSC, no public spec). **We switched to USB + KVComPlus** (`C:\Program Files (x86)\KEYENCE\KVComPlusLB\bin\DataBuilder.dll`).

```
Main FastAPI (64-bit)
   │   HTTP localhost:8765 (writes/reads/control)
   │   long-poll /events (bit-change events from PLC)
   ▼
plc_bridge.py (32-bit Python embedded in backend/py32/)
   - ctypes → DataBuilder.dll
   - polling thread: DBKvReadMonitorDataBit  ← ~0.51 ms/call, 1900+ polls/sec
   - heartbeat thread: DBWrite DM10 every 200 ms
   ▼
USB → KV-3000
```

Why the 32-bit subprocess: `DataBuilder.dll` is 32-bit only, but our backend Python is 64-bit. The bridge is the smallest possible 32-bit boundary.

Device mapping (configurable in `config.yaml: hardware.plc.device_map`):
- B0–B4 (Web→PLC) → MR0–MR4 (direct write)
- B5–B7 (PLC→Web) → MR5/MR6/MR7 (batch polled, contiguous for one DBKvReadMonitorDataBit call)
- DM28 (loop count), DM30 (position), DM32 (speed), DM10 (heartbeat)

## What to work on next

**Plan 3 remaining — Imada + ESP32 real drivers:**
- `backend/app/hardware/imada.py` — already drafted; needs hardware-in-loop test on COM4
- `backend/app/hardware/esp32.py` — already drafted; needs hardware
- Once both pass `smoke_test_*` style sanity, set `config.yaml: mock_mode: false`

Diagnostic scripts live in [backend/scripts/](backend/scripts/README.md) — `benchmark_plc_usb.py` for raw DLL latency, `smoke_test_plc.py` for end-to-end RealPlc check.
