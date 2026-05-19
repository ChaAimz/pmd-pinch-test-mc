# Pinch Test Machine — Design Spec

**Date:** 2026-05-19
**Status:** Draft (pending user review)

## 1. Purpose & Scope

A web-based control and data-acquisition application for a pinch test machine. The application drives a Keyence PLC (KV-3000 or KV-LH20V via KV-Link protocol), reads a clamp force sensor (ESP32 + HX711 via RS232), and streams tensile force data from an Imada force gauge (RS232) into a real-time line chart. It manages test recipes, executes a test sequence loop (move, clamp, tension check, unclamp, repeat), and records summary metrics + raw waveforms for traceability.

**Deployment:** single-machine local app on Windows. Backend Python + Frontend Vite both run on the same machine connected to the hardware via serial ports. Operator uses a browser at `localhost`.

## 2. Hardware Interfaces

| Device | Transport | Direction | Notes |
|---|---|---|---|
| Keyence PLC (KV-3000 RJ45 serial **or** KV-LH20V RS485) | Serial via KV-Link ASCII protocol | Full-duplex (request/response) | Abstracted: same client handles both variants; only port + baud differ |
| Imada force gauge (ZTS / ZTA series) | RS232 | Send-only stream (Imada → PC) | Continuous mode, format `+001.23N\r\n`, baud 19200 |
| ESP32 + HX711 clamp force sensor | RS232 | Send-only stream (ESP32 → PC) | Integer raw count per line, requires calibration (slope/offset) to Newton, baud 115200 |

### 2.1 PLC bit map

| Bit | Direction | Meaning |
|---|---|---|
| B0 | Web → PLC | Start session (after writing W100/W102/W0) |
| B1 | Web → PLC | Stop / abort (E-Stop) |
| B2 | Web → PLC | Reset state |
| B3 | Web → PLC | Press Clamp (operator-initiated or auto) |
| B4 | Web → PLC | Stop clamp actuator (when ESP32 force ≥ threshold) |
| B5 | PLC → Web | Start tension check (Imada read begins) |
| B6 | PLC → Web | End tension check (Imada read ends) |
| B7 | PLC → Web | Finish process (all loops complete) |

### 2.2 PLC word map

| Word | Direction | Meaning |
|---|---|---|
| W0 | Web → PLC | Loop count (number of test repetitions) |
| W100 | Web → PLC | Actuator 1 vertical position (mm × 100 — e.g. 25.0 mm → 2500) |
| W102 | Web → PLC | Actuator 1 speed (mm/s × 100 — e.g. 10 mm/s → 1000) |
| W10 | Web → PLC | Heartbeat (incremented every 200 ms; PLC ladder uses for fail-safe) |

## 3. High-Level Architecture

```
+----------------------------------------------------------------+
|                    Browser (localhost:5173)                     |
|              Vite + React + ShadcnUI + uPlot                   |
|                                                                 |
|  Pages: Run Test | Recipes | History | Hardware | Settings    |
+-------------------------------+---------------------------------+
                                | HTTP REST + WebSocket
                                | (ws://localhost:8000/ws)
                                v
+----------------------------------------------------------------+
|              FastAPI Backend (single process, :8000)            |
|                                                                 |
|  REST API   |  WebSocket hub  |  Test Runner (asyncio task)    |
|       |              ^                      |                   |
|       |              |  asyncio.Queue       v                   |
|       |        +-----+------+   +-------------------+           |
|       |        | Event Bus  |<--| Hardware Manager  |           |
|       |        +-----+------+   +-------------------+           |
|       v              |             |       |       |            |
|  +---------+         |    bridge: call_soon_threadsafe         |
|  | SQLite  |         v             v       v       v            |
|  | recipes |    +----+----+  +-----+--+  +-+-----+ +---------+ |
|  | runs    |    | PLC     |  | Imada  |  | ESP32 | | logging | |
|  | loops   |    | thread  |  | thread |  | thread| +---------+ |
|  +---------+    | pyserial|  | pyserial| | pyser-|             |
|                 +----+----+  +----+---+ |  ial   |             |
|  +---------+         |           |     +-+------+              |
|  | data/   |         v           v        |                    |
|  | wave-   |       [COM3]    [COM5]    [COM7]                  |
|  | forms/  |       KV-Link   Imada     ESP32                   |
|  +---------+       RJ45/485  ZTS RS232 HX711 RS232             |
+----------------------------------------------------------------+
```

**Approach: A — Single FastAPI + asyncio + thread-per-serial.** Each serial driver runs in a dedicated worker thread (blocking `pyserial`) and bridges data into the asyncio loop via `asyncio.Queue` + `loop.call_soon_threadsafe`. Chosen over pure async (`pyserial-asyncio` is unstable on Windows) and over microservices (overkill on single machine).

## 4. Test Runner State Machine

```
IDLE
  → operator selects recipe + (operator/batch/shift) + mode (manual/auto), clicks Start
WRITE_PLC_PARAMS
  → write W100, W102, W0; set B0
LOOP_BEGIN (loop_index = 1)
  → manual: wait for operator "Clamp" button; auto: auto-trigger immediately
CLAMP_PRESSED
  → set B3; ESP32 stream starts plotting
WAIT_CLAMP_FORCE
  → loop reads ESP32 samples; if force_n ≥ recipe.clamp_threshold_n → set B4
WAIT_B5
  → wait for PLC bit B5 = ON (timeout: configurable, default 30s)
TENSION_CHECK
  → consume Imada samples at sampling_hz, broadcast via WebSocket, write to in-memory buffer
  → exits when PLC bit B6 = ON (timeout: configurable, default 30s)
EVALUATE
  → compute peak_force = max(buffer.force_n), avg_force = mean(buffer.force_n)
  → compute hold_time_ms = total duration where force_n ≥ recipe.min_force_n (when min_force_n set; else 0)
  → judgment = 'pass' iff:
      (recipe.min_force_n is null OR peak_force_n ≥ recipe.min_force_n) AND
      (recipe.max_force_n is null OR peak_force_n ≤ recipe.max_force_n) AND
      (recipe.hold_time_ms is null OR hold_time_ms ≥ recipe.hold_time_ms)
      else 'fail'
  → persist test_loops row + write parquet to data/waveforms/<run_id>/loop_NNN.parquet
UNCLAMP
  → reset B3, B4; PLC ladder drives unclamp
  → if loop_index < recipe.loop_count → LOOP_BEGIN (loop_index += 1); else → DONE_B7
DONE_B7
  → wait for PLC bit B7 = ON (timeout: 30s)
  → mark test_run.status from per-loop judgments (all pass → 'pass', any fail → 'fail')
  → return to IDLE

Transitions valid from any state:
  ABORT (B1)   → operator E-Stop or system error: set B1, status='aborted', back to IDLE after acknowledge
  RESET (B2)   → operator reset after error/abort, set B2, back to IDLE
  ERROR        → unrecoverable serial/timeout failure: status='error', awaits operator action
```

## 5. Hardware Abstraction Layer

### 5.1 Common protocols (`backend/app/hardware/base.py`)

```python
class HardwareDevice(Protocol):
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
    @property
    def is_connected(self) -> bool: ...
```

### 5.2 `PlcKvLink`

- KV-Link ASCII commands:
  - Write word: `WR W100 2500\r` → `OK\r\n`
  - Read word: `RD W100\r` → `2500\r\n`
  - Set bit: `ST B3\r` → `OK\r\n`
  - Reset bit: `RS B3\r` → `OK\r\n`
  - Read bit: `RD B5\r` → `1\r\n`
- Multi-bit read for efficiency: KV-Link multi-relay form (`RDS B5 3\r` for KV-3000; verify exact mnemonic against the Keyence KV-Link manual for the connected PLC family during implementation — fall back to three separate `RD B5/B6/B7` calls if not supported)
- Polls B5, B6, B7 every 20 ms (50 Hz); pushes edge-change events into `plc_event_queue`
- Heartbeat: writes W10 = (counter++) every 200 ms
- Same client works for KV-3000 RJ45 (DB9 cable) and KV-LH20V RS485 (USB-RS485 adapter) — only port + baud differ

### 5.3 `ImadaForceGauge`

- Listener thread reads bytes, accumulates until `\r\n`, parses: regex `^([+-]?\d+\.\d+)([A-Za-z]+)$`
- Imada ZTS unit must be set to **N** at the device (front panel) — parser logs a warning and drops the sample if any other unit is received (no auto-conversion; the calibration of the test depends on a fixed unit)
- Emits `Reading(timestamp_ns, force_n)` to `imada_queue`
- Continuous mode (Imada ZTS configured at device front panel)

### 5.4 `Esp32ForceSensor`

- Listener thread reads bytes line-by-line; parses integer (raw HX711 count)
- Applies calibration: `force_n = (raw - offset) * slope`
- Emits `Reading(timestamp_ns, force_n, raw)` to `esp32_queue`

### 5.5 `HardwareManager`

- Owns all three device instances + their worker threads
- Exposes `asyncio.Queue` per device for the Test Runner and WebSocket hub
- Lifecycle: `start()` on FastAPI lifespan startup, `shutdown()` on shutdown (sends B1, B2, then disconnects)
- Hot-reconnect: REST endpoint can disconnect + reconnect a single device without restarting app

### 5.6 Mock drivers (`backend/app/hardware/mock/`)

- `MockPlcKvLink`: in-memory bits + words; auto-triggers B5/B6/B7 after configurable delays
- `MockImadaForceGauge`: emits a synthetic sine wave between B5 and B6
- `MockEsp32ForceSensor`: emits ramp up to threshold then plateau
- Enabled when `config.yaml: mock_mode: true` — allows full app development & integration tests on any machine

## 6. Data Model & Storage

### 6.1 SQLite schema

```sql
CREATE TABLE recipes (
    id                  INTEGER PRIMARY KEY,
    name                TEXT UNIQUE NOT NULL,
    description         TEXT,
    position_mm         REAL NOT NULL,        -- W100 = × 100
    speed_mms           REAL NOT NULL,        -- W102 = × 100
    clamp_threshold_n   REAL NOT NULL,
    loop_count          INTEGER NOT NULL,     -- W0
    min_force_n         REAL,                 -- nullable: no min check if null
    max_force_n         REAL,                 -- nullable: no max check if null
    hold_time_ms        INTEGER,              -- nullable: no hold check if null
    sampling_hz         INTEGER NOT NULL DEFAULT 50,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE test_runs (
    id                  INTEGER PRIMARY KEY,
    recipe_id           INTEGER NOT NULL REFERENCES recipes(id),
    operator            TEXT,
    batch_id            TEXT,
    shift               TEXT,
    started_at          TEXT NOT NULL,
    finished_at         TEXT,
    status              TEXT NOT NULL,        -- running | pass | fail | aborted | error
    abort_reason        TEXT,
    loops_completed     INTEGER NOT NULL DEFAULT 0,
    waveform_dir        TEXT                  -- relative: data/waveforms/<id>/
);

CREATE TABLE test_loops (
    id                  INTEGER PRIMARY KEY,
    run_id              INTEGER NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    loop_index          INTEGER NOT NULL,
    started_at          TEXT NOT NULL,
    finished_at         TEXT,
    peak_force_n        REAL,
    avg_force_n         REAL,
    hold_time_ms        INTEGER,
    judgment            TEXT,                 -- pass | fail | NULL (aborted)
    waveform_file       TEXT                  -- e.g. loop_001.parquet
);

CREATE INDEX idx_runs_started ON test_runs(started_at DESC);
CREATE INDEX idx_loops_run ON test_loops(run_id, loop_index);
```

### 6.2 Waveform storage

```
data/
├── pinch.db
└── waveforms/
    └── <run_id>/
        ├── loop_001.parquet
        ├── loop_002.parquet
        └── chart_loop_001.png        # optional snapshot for report
```

**Parquet schema per loop:**

| column | type | description |
|---|---|---|
| `t_ms` | uint32 | milliseconds since B5 edge for that loop |
| `force_n` | float32 | parsed Imada reading in Newton |

Written with PyArrow at loop end (after B6); buffered in memory during TENSION_CHECK.

## 7. REST API

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/api/recipes` | list (search by name) |
| POST | `/api/recipes` | create |
| GET | `/api/recipes/{id}` | get one |
| PUT | `/api/recipes/{id}` | update |
| DELETE | `/api/recipes/{id}` | delete |
| POST | `/api/sessions/start` | `{recipe_id, operator, batch_id, shift, mode: 'manual'|'auto'}` → `{run_id}` |
| POST | `/api/sessions/{id}/clamp` | manual mode: trigger B3 |
| POST | `/api/sessions/{id}/stop` | E-Stop: sets B1 |
| POST | `/api/sessions/{id}/reset` | sets B2 |
| GET | `/api/runs` | paginated list (filter: recipe, status, operator, date range) |
| GET | `/api/runs/{id}` | run detail + loops |
| GET | `/api/runs/{id}/loops/{idx}/waveform` | JSON `{t_ms[], force_n[]}` from parquet for chart |
| GET | `/api/runs/{id}/export.csv` | full run as CSV (zipped if multi-loop) |
| GET | `/api/hardware/status` | per-device: connected, port, last_data_at |
| POST | `/api/hardware/reconnect` | `{device: 'plc'|'imada'|'esp32'}` |
| POST | `/api/hardware/esp32/calibrate` | `{raw_at_zero, raw_at_known, known_force_n}` → updates config |
| GET | `/api/config` | read merged config |
| PUT | `/api/config` | update (writes config.yaml) — restarts HardwareManager |

## 8. WebSocket Protocol

Endpoint: `/ws` — single channel, all clients receive all events.

```jsonc
// High-frequency sample batches (every 50 ms during TENSION_CHECK)
// At 100 Hz Imada output → ~5 samples per batch; backend keeps t_ms relative to that loop's B5 edge
{"type": "imada_batch", "run_id": 7, "loop": 1, "samples": [[0, 0.12], [10, 0.23], ...]}  // [t_ms, force_n][]

// ESP32 samples during CLAMP_PRESSED → WAIT_CLAMP_FORCE
{"type": "esp32_batch", "run_id": 7, "samples": [[t_ms, force_n], ...]}

// State transitions (low frequency)
{"type": "state_change", "run_id": 7, "from": "WAIT_B5", "to": "TENSION_CHECK", "loop": 1, "at": "2026-05-19T10:30:01.234Z"}

// PLC events
{"type": "plc_bit", "addr": 5, "value": true}

// Loop result
{"type": "loop_result", "run_id": 7, "loop": 1, "peak_force_n": 8.2, "avg_force_n": 7.1, "hold_time_ms": 540, "judgment": "pass"}

// Run finished
{"type": "run_finished", "run_id": 7, "status": "pass", "loops_completed": 10}

// Errors
{"type": "error", "source": "imada", "code": "TIMEOUT", "message": "no data for 1000ms"}

// Hardware status push (when a port reconnects or drops)
{"type": "hw_status", "device": "plc", "connected": false}
```

**Backpressure:** if WS client lags, drop oldest batches (real-time chart > completeness; raw data is in parquet).

## 9. Frontend Pages

### 9.1 Sitemap
- `/` → redirect `/run`
- `/run` — main operator page
- `/recipes`, `/recipes/new`, `/recipes/:id/edit`
- `/history`, `/history/:id`
- `/hardware`
- `/settings`

### 9.2 Run Test page

Sections:
1. **Header** — hardware status dots (clickable → `/hardware`)
2. **Recipe selector + operator metadata** — recipe dropdown, mode toggle (Manual/Auto), operator/batch/shift inputs, expanded recipe parameters readout
3. **Session controls** — Start Session button (becomes Stop when running), loop counter `3 / 10`, big red E-STOP button, manual Clamp button (visible only in Manual mode + during CLAMP_PRESSED-eligible state)
4. **Live chart** — uPlot canvas; X = ms since B5, Y = Newton; updates every 50 ms from `imada_batch`
5. **ESP32 live readout** — single big number + small sparkline during clamp phase
6. **Per-loop results grid** — table showing loop index, judgment, peak force; rows fill as loops complete

### 9.3 Recipes page
- ShadcnUI DataTable: list with search
- Create/Edit form: Zod-validated fields (position > 0, speed > 0, threshold > 0, loop_count ≥ 1, max > min if both set)

### 9.4 History page
- Filter bar: date range, recipe, status, operator
- Run list table
- Run detail page: per-loop chart (load parquet → JSON), summary, export CSV

### 9.5 Hardware page
- Live connection status per device
- Reconnect buttons
- ESP32 calibration wizard (2-point linear fit)

### 9.6 Settings page
- Edit `config.yaml` via form
- Save is disabled while a session is `running` — operator must Stop or wait for B7 before applying changes
- Save → triggers HardwareManager restart (devices reconnect with new config; existing data unaffected)

## 10. Project Structure

```
pinch-test-mc/
├── README.md
├── CLAUDE.md
├── .gitignore
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── config.example.yaml
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── deps.py
│   │   ├── db/
│   │   │   ├── engine.py
│   │   │   ├── models.py
│   │   │   └── migrations/
│   │   ├── hardware/
│   │   │   ├── base.py
│   │   │   ├── plc_kvlink.py
│   │   │   ├── force_gauge_imada.py
│   │   │   ├── esp32_sensor.py
│   │   │   ├── manager.py
│   │   │   └── mock/
│   │   ├── services/
│   │   │   ├── recipe.py
│   │   │   ├── test_runner.py
│   │   │   ├── waveform.py
│   │   │   └── event_bus.py
│   │   ├── api/
│   │   │   ├── recipes.py
│   │   │   ├── sessions.py
│   │   │   ├── runs.py
│   │   │   ├── hardware.py
│   │   │   ├── config.py
│   │   │   └── ws.py
│   │   └── schemas/
│   └── tests/
│       ├── unit/
│       └── integration/
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── components.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── router.tsx
│       ├── lib/
│       │   ├── api.ts
│       │   ├── ws.ts
│       │   └── utils.ts
│       ├── components/
│       │   ├── ui/
│       │   ├── ForceChart.tsx
│       │   ├── HardwareStatus.tsx
│       │   ├── EStopButton.tsx
│       │   └── ...
│       ├── pages/
│       │   ├── Run.tsx
│       │   ├── Recipes.tsx
│       │   ├── RecipeForm.tsx
│       │   ├── History.tsx
│       │   ├── RunDetail.tsx
│       │   ├── Hardware.tsx
│       │   └── Settings.tsx
│       └── store/
│           └── session.ts
├── data/                       # gitignored
│   ├── pinch.db
│   └── waveforms/
└── docs/
    └── superpowers/specs/
        └── 2026-05-19-pinch-test-machine-design.md
```

## 11. Tech Versions

**Backend (Python 3.11+):**
- `fastapi` ≥ 0.115, `uvicorn[standard]`
- `pyserial` ≥ 3.5
- `pydantic` v2, `pydantic-settings`
- `sqlmodel` (SQLAlchemy 2 + pydantic) + `alembic`
- `pyarrow` (parquet)
- `pyyaml`, `loguru`
- `pytest`, `pytest-asyncio`, `httpx`

**Frontend (Node 20+):**
- `vite` ≥ 5, `react` 19, `react-router-dom` 7, `typescript` 5
- ShadcnUI (installed via MCP shadcn server)
- `tailwindcss` 4
- `uplot` 1.6.x
- `zustand`, `zod`, `@tanstack/react-query`

## 12. Configuration (`backend/config.yaml`)

```yaml
hardware:
  plc:
    enabled: true
    port: "COM3"
    baud: 38400
    poll_bits: [5, 6, 7]
    poll_interval_ms: 20
    heartbeat_word: 10
    heartbeat_interval_ms: 200
  imada:
    enabled: true
    port: "COM5"
    baud: 19200
    decimal_format: true
  esp32:
    enabled: true
    port: "COM7"
    baud: 115200
    calibration:
      slope: 0.0123
      offset: -45
  state_timeouts:
    wait_clamp_force_ms: 10000
    wait_b5_ms: 30000
    tension_check_ms: 30000
    done_b7_ms: 30000

mock_mode: false

storage:
  db_path: "data/pinch.db"
  waveforms_dir: "data/waveforms"

server:
  host: "127.0.0.1"
  port: 8000
```

## 13. Error Handling & Safety

| Source | Failure | Reaction |
|---|---|---|
| PLC serial port disconnect | port error | emit `error` WS, transition → ERROR, allow Reconnect from `/hardware` |
| PLC command timeout (>500 ms) | no `OK\r\n` | retry 2× then ERROR |
| Stuck PLC bit poll (B5/B6/B7) | exceeds state timeout | transition → ABORTED, sets B1 |
| Imada port silent >1 s during TENSION_CHECK | no samples | abort + ERROR + auto-attempt reconnect |
| ESP32 silent >1 s during clamp | no samples | abort + ERROR ("clamp threshold not measurable") |
| Clamp force not reached within `wait_clamp_force_ms` | actuator at max | abort + B1 + ERROR ("clamp force not reached") |
| Frontend WS disconnect | UI desync | UI auto-reconnect (expo backoff); backend session continues |
| App crash mid-test | process exit | on next start: rows with `status='running'` → `aborted (recovered)` |

**Safety invariants:**
- B1 (Stop) has top priority — bypasses queue, sent immediately on E-Stop click
- Every state has a timeout — no state waits forever for a PLC bit
- HardwareManager sends B1 + B2 on shutdown — prevents clamp lockout when app closes
- Heartbeat W10 — Python increments every 200 ms; PLC ladder uses for fail-safe stop if stale

## 14. Testing Strategy

**Unit:**
- KV-Link parser (commands + responses + partial frames)
- Imada parser (multi-line buffer, malformed lines, sign + decimal variations)
- ESP32 parser (integer + calibration application)
- Recipe validators (Zod + pydantic)
- State machine transitions (table-driven: state × event → next state)

**Integration:**
- Test runner full flow with mock hardware (auto-triggers B5/B6/B7) → asserts DB rows + parquet files
- E2E via httpx async client: start session, drive mock events, verify final test_run state

**Hardware-in-loop manual checklist (pre-deployment):**
- Connection per device
- Known-weight calibration for ESP32
- 100-loop stress run
- E-Stop interrupt at every state
- Power cycle PLC mid-run → recovery behavior

**Logging:** `loguru` → `logs/app.log` daily rotate. INFO in production, DEBUG when troubleshooting.

## 15. Non-Goals

- Multi-user authentication / RBAC
- Cloud sync, MES integration, OPC-UA
- Mobile responsive UI
- Internationalization (Thai only at launch)
- Compare mode in history (defer)
- ESP32 firmware development (assumed available, integer-per-line over RS232)

## 16. Open Questions

None at draft time. Awaiting user review.
