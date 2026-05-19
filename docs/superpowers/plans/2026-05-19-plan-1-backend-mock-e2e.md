# Plan 1 — Backend Foundation + Mock-Driven E2E

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FastAPI backend with hardware abstraction, mock drivers, state machine, REST + WebSocket APIs, and an integration test that exercises a full pinch-test session end-to-end without any real hardware.

**Architecture:** Single FastAPI process. Each future serial driver runs in a worker thread; mocks emulate the same interface in-process. State machine runs as an asyncio task and broadcasts events through an in-process event bus + WebSocket hub. SQLite + Parquet (PyArrow) for storage.

**Tech Stack:** Python 3.11+, FastAPI 0.115+, uvicorn, SQLModel + SQLAlchemy 2 + Alembic, PyArrow, pyserial (declared, used in Plan 3), pyyaml, pydantic v2 + pydantic-settings, loguru, pytest + pytest-asyncio + httpx.

**Spec reference:** [docs/superpowers/specs/2026-05-19-pinch-test-machine-design.md](../specs/2026-05-19-pinch-test-machine-design.md)

---

## File Structure (Plan 1 scope)

```
pinch-test-mc/
├── .gitignore
├── README.md                                # placeholder
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── config.example.yaml
│   ├── config.yaml                          # gitignored (created from example)
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                          # FastAPI entry + lifespan
│   │   ├── config.py                        # Settings loader
│   │   ├── logging_setup.py                 # loguru config
│   │   ├── deps.py                          # FastAPI dependencies (db session, manager handle)
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── engine.py                    # SQLite engine + session factory
│   │   │   ├── models.py                    # SQLModel classes
│   │   │   └── migrations/                  # alembic env + versions
│   │   ├── hardware/
│   │   │   ├── __init__.py
│   │   │   ├── base.py                      # Protocols + dataclasses
│   │   │   ├── manager.py                   # HardwareManager
│   │   │   └── mock/
│   │   │       ├── __init__.py
│   │   │       ├── mock_plc.py
│   │   │       ├── mock_imada.py
│   │   │       └── mock_esp32.py
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── recipe_service.py
│   │   │   ├── event_bus.py                 # async pub/sub
│   │   │   ├── state_machine.py             # pure logic
│   │   │   ├── test_runner.py               # wires state machine + hardware + persistence
│   │   │   ├── waveform.py                  # parquet write/read via PyArrow
│   │   │   └── ws_hub.py                    # WebSocket broadcaster
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── recipes.py
│   │   │   ├── sessions.py
│   │   │   ├── runs.py
│   │   │   ├── hardware.py
│   │   │   ├── config.py
│   │   │   └── ws.py
│   │   └── schemas/
│   │       ├── __init__.py
│   │       ├── recipe.py
│   │       ├── session.py
│   │       ├── run.py
│   │       ├── hardware.py
│   │       └── ws_messages.py
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py
│       ├── unit/
│       │   ├── test_config.py
│       │   ├── test_recipe_service.py
│       │   ├── test_state_machine.py
│       │   ├── test_waveform.py
│       │   ├── test_event_bus.py
│       │   └── test_mock_drivers.py
│       └── integration/
│           ├── test_recipes_api.py
│           ├── test_runs_api.py
│           ├── test_hardware_api.py
│           ├── test_ws.py
│           └── test_full_session_e2e.py
├── data/                                    # gitignored
│   ├── pinch.db
│   └── waveforms/
└── docs/
    ├── superpowers/
    │   ├── specs/2026-05-19-pinch-test-machine-design.md
    │   └── plans/2026-05-19-plan-1-backend-mock-e2e.md  # this file
```

---

## Conventions used in this plan

- All commands assume working directory `c:\Users\Aimz\source\repos\pmd-pinch-test-mc` unless stated otherwise. Use `cd backend` for `pytest`/`uvicorn`/`alembic` commands.
- All Python code uses type hints. All public functions get docstrings only when behavior isn't obvious from the name and signature.
- Tests use `pytest` + `pytest-asyncio`. Async tests use the `@pytest.mark.asyncio` decorator.
- DB session in tests is created with an in-memory SQLite override.
- Each task ends with a commit. If `git` is not initialized at Task 1's first step, commits are skipped silently — but Task 1 initializes git.
- When a step says "Run …", expected output is given. Treat the test as passing only if the relevant assertion line matches.

---

### Task 1: Initialize repository, project skeleton, .gitignore

**Files:**
- Create: `.gitignore`, `README.md`, `backend/pyproject.toml`, `backend/config.example.yaml`, `data/.gitkeep`, `data/waveforms/.gitkeep`

- [ ] **Step 1: Initialize git**

Run:
```
git init
git config core.autocrlf true
```
Expected: `Initialized empty Git repository in ...`

- [ ] **Step 2: Create `.gitignore`**

```
# Python
__pycache__/
*.pyc
*.pyo
.venv/
.uv/
.pytest_cache/
.mypy_cache/
.ruff_cache/
*.egg-info/

# Node
node_modules/
dist/
.vite/

# OS
.DS_Store
Thumbs.db

# Project
backend/config.yaml
data/pinch.db
data/pinch.db-journal
data/pinch.db-wal
data/pinch.db-shm
data/waveforms/*
!data/waveforms/.gitkeep
logs/
```

- [ ] **Step 3: Create `README.md`**

```markdown
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
```

- [ ] **Step 4: Create `backend/pyproject.toml`**

```toml
[project]
name = "pinch-test-mc-backend"
version = "0.1.0"
description = "Pinch test machine backend (FastAPI + mock/real hardware drivers)"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "websockets>=12",
    "pyserial>=3.5",
    "pydantic>=2.7",
    "pydantic-settings>=2.4",
    "sqlmodel>=0.0.21",
    "alembic>=1.13",
    "pyarrow>=16",
    "pyyaml>=6",
    "loguru>=0.7",
    "anyio>=4",
]

[project.optional-dependencies]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "httpx>=0.27",
    "ruff>=0.5",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["."]
include = ["app*"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py311"
```

- [ ] **Step 5: Create `backend/config.example.yaml`**

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
      offset: -45.0
  state_timeouts:
    wait_clamp_force_ms: 10000
    wait_b5_ms: 30000
    tension_check_ms: 30000
    done_b7_ms: 30000

mock_mode: true

storage:
  db_url: "sqlite:///./../data/pinch.db"
  waveforms_dir: "../data/waveforms"

server:
  host: "127.0.0.1"
  port: 8000
```

- [ ] **Step 6: Touch placeholder dirs**

Create empty files: `data/.gitkeep`, `data/waveforms/.gitkeep`.

- [ ] **Step 7: Commit**

```
git add .
git commit -m "chore: initial project skeleton + pyproject + config example"
```

---

### Task 2: Config loader (Pydantic-settings + YAML)

**Files:**
- Create: `backend/app/__init__.py`, `backend/app/config.py`
- Test: `backend/tests/__init__.py`, `backend/tests/conftest.py`, `backend/tests/unit/__init__.py`, `backend/tests/unit/test_config.py`

- [ ] **Step 1: Write the failing test `tests/unit/test_config.py`**

```python
import textwrap
from pathlib import Path

import pytest

from app.config import Settings, load_settings


def test_load_settings_from_yaml(tmp_path: Path):
    yaml_text = textwrap.dedent(
        """
        hardware:
          plc:
            enabled: true
            port: "COM10"
            baud: 38400
            poll_bits: [5, 6, 7]
            poll_interval_ms: 20
            heartbeat_word: 10
            heartbeat_interval_ms: 200
          imada:
            enabled: true
            port: "COM11"
            baud: 19200
            decimal_format: true
          esp32:
            enabled: true
            port: "COM12"
            baud: 115200
            calibration:
              slope: 0.01
              offset: 0.0
          state_timeouts:
            wait_clamp_force_ms: 5000
            wait_b5_ms: 30000
            tension_check_ms: 30000
            done_b7_ms: 30000
        mock_mode: true
        storage:
          db_url: "sqlite:///./test.db"
          waveforms_dir: "./wf"
        server:
          host: "127.0.0.1"
          port: 8000
        """
    ).strip()
    cfg = tmp_path / "config.yaml"
    cfg.write_text(yaml_text, encoding="utf-8")

    settings: Settings = load_settings(cfg)

    assert settings.mock_mode is True
    assert settings.hardware.plc.port == "COM10"
    assert settings.hardware.imada.baud == 19200
    assert settings.hardware.esp32.calibration.slope == 0.01
    assert settings.hardware.state_timeouts.tension_check_ms == 30000
    assert settings.storage.db_url == "sqlite:///./test.db"


def test_load_settings_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_settings(tmp_path / "nope.yaml")
```

- [ ] **Step 2: Add an empty `conftest.py`**

```python
# tests/conftest.py
import sys
from pathlib import Path

# Make `app` importable regardless of where pytest is run from.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
```

- [ ] **Step 3: Run test, expect failure**

Run (from `backend/`):
```
pytest tests/unit/test_config.py -v
```
Expected: `ModuleNotFoundError: No module named 'app.config'`.

- [ ] **Step 4: Implement `app/config.py`**

```python
from __future__ import annotations

from pathlib import Path
from typing import List

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PlcConfig(BaseModel):
    enabled: bool = True
    port: str = "COM3"
    baud: int = 38400
    poll_bits: List[int] = Field(default_factory=lambda: [5, 6, 7])
    poll_interval_ms: int = 20
    heartbeat_word: int = 10
    heartbeat_interval_ms: int = 200


class ImadaConfig(BaseModel):
    enabled: bool = True
    port: str = "COM5"
    baud: int = 19200
    decimal_format: bool = True


class Esp32Calibration(BaseModel):
    slope: float
    offset: float


class Esp32Config(BaseModel):
    enabled: bool = True
    port: str = "COM7"
    baud: int = 115200
    calibration: Esp32Calibration


class StateTimeouts(BaseModel):
    wait_clamp_force_ms: int = 10000
    wait_b5_ms: int = 30000
    tension_check_ms: int = 30000
    done_b7_ms: int = 30000


class HardwareConfig(BaseModel):
    plc: PlcConfig
    imada: ImadaConfig
    esp32: Esp32Config
    state_timeouts: StateTimeouts = Field(default_factory=StateTimeouts)


class StorageConfig(BaseModel):
    db_url: str = "sqlite:///./pinch.db"
    waveforms_dir: str = "./waveforms"


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8000


class Settings(BaseSettings):
    hardware: HardwareConfig
    storage: StorageConfig
    server: ServerConfig
    mock_mode: bool = True

    model_config = SettingsConfigDict(env_prefix="PINCH_", env_nested_delimiter="__")


def load_settings(path: Path | str) -> Settings:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    return Settings.model_validate(raw)
```

- [ ] **Step 5: Create `app/__init__.py`** (empty file)

- [ ] **Step 6: Run test, expect pass**

```
pytest tests/unit/test_config.py -v
```
Expected: both tests PASS.

- [ ] **Step 7: Commit**

```
git add backend/app/__init__.py backend/app/config.py backend/tests
git commit -m "feat(config): yaml-backed settings loader with pydantic-settings"
```

---

### Task 3: Logging setup

**Files:**
- Create: `backend/app/logging_setup.py`
- Test: `backend/tests/unit/test_logging.py`

- [ ] **Step 1: Write failing test `tests/unit/test_logging.py`**

```python
import logging

from app.logging_setup import configure_logging


def test_configure_logging_returns_logger(tmp_path):
    logger = configure_logging(level="DEBUG", log_dir=tmp_path)
    logger.debug("hello")
    log_files = list(tmp_path.glob("*.log"))
    assert len(log_files) == 1


def test_configure_logging_default_level(tmp_path):
    logger = configure_logging(level="INFO", log_dir=tmp_path)
    assert logger is not None
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_logging.py -v
```
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `app/logging_setup.py`**

```python
from __future__ import annotations

from pathlib import Path

from loguru import logger


def configure_logging(level: str = "INFO", log_dir: Path | str = "logs"):
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)
    logger.remove()
    logger.add(
        log_path / "app.log",
        rotation="00:00",
        retention="14 days",
        level=level,
        enqueue=True,
        backtrace=True,
        diagnose=False,
    )
    logger.add(
        sink=lambda msg: print(msg, end=""),  # stdout
        level=level,
    )
    return logger
```

- [ ] **Step 4: Run test, expect pass**

```
pytest tests/unit/test_logging.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/app/logging_setup.py backend/tests/unit/test_logging.py
git commit -m "feat(logging): loguru-based logger with rotating file sink"
```

---

### Task 4: Database engine + SQLModel models

**Files:**
- Create: `backend/app/db/__init__.py`, `backend/app/db/engine.py`, `backend/app/db/models.py`
- Test: `backend/tests/unit/test_models.py`

- [ ] **Step 1: Write failing test `tests/unit/test_models.py`**

```python
from datetime import datetime

from sqlmodel import Session, SQLModel, create_engine, select

from app.db.models import Recipe, TestLoop, TestRun


def test_models_persist_and_query():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)

    with Session(engine) as s:
        r = Recipe(
            name="r1",
            description="d",
            position_mm=10.0,
            speed_mms=5.0,
            clamp_threshold_n=7.0,
            loop_count=3,
            min_force_n=1.0,
            max_force_n=10.0,
            hold_time_ms=200,
            sampling_hz=50,
            created_at=datetime.utcnow().isoformat(),
            updated_at=datetime.utcnow().isoformat(),
        )
        s.add(r)
        s.commit()
        s.refresh(r)
        assert r.id is not None

        run = TestRun(
            recipe_id=r.id,
            operator="op1",
            started_at=datetime.utcnow().isoformat(),
            status="running",
        )
        s.add(run)
        s.commit()
        s.refresh(run)

        loop = TestLoop(
            run_id=run.id,
            loop_index=1,
            started_at=datetime.utcnow().isoformat(),
            judgment="pass",
            peak_force_n=8.0,
            avg_force_n=6.0,
            hold_time_ms=300,
        )
        s.add(loop)
        s.commit()

        fetched = s.exec(select(TestLoop).where(TestLoop.run_id == run.id)).all()
        assert len(fetched) == 1
        assert fetched[0].judgment == "pass"
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_models.py -v
```
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Create `app/db/__init__.py`** (empty)

- [ ] **Step 4: Implement `app/db/models.py`**

```python
from __future__ import annotations

from typing import Optional

from sqlmodel import Field, Relationship, SQLModel


class Recipe(SQLModel, table=True):
    __tablename__ = "recipes"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    description: Optional[str] = None
    position_mm: float
    speed_mms: float
    clamp_threshold_n: float
    loop_count: int
    min_force_n: Optional[float] = None
    max_force_n: Optional[float] = None
    hold_time_ms: Optional[int] = None
    sampling_hz: int = 50
    created_at: str
    updated_at: str


class TestRun(SQLModel, table=True):
    __tablename__ = "test_runs"

    id: Optional[int] = Field(default=None, primary_key=True)
    recipe_id: int = Field(foreign_key="recipes.id", index=True)
    operator: Optional[str] = None
    batch_id: Optional[str] = None
    shift: Optional[str] = None
    started_at: str = Field(index=True)
    finished_at: Optional[str] = None
    status: str  # running | pass | fail | aborted | error
    abort_reason: Optional[str] = None
    loops_completed: int = 0
    waveform_dir: Optional[str] = None


class TestLoop(SQLModel, table=True):
    __tablename__ = "test_loops"

    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="test_runs.id", index=True)
    loop_index: int
    started_at: str
    finished_at: Optional[str] = None
    peak_force_n: Optional[float] = None
    avg_force_n: Optional[float] = None
    hold_time_ms: Optional[int] = None
    judgment: Optional[str] = None
    waveform_file: Optional[str] = None
```

- [ ] **Step 5: Implement `app/db/engine.py`**

```python
from __future__ import annotations

from typing import Iterator

from sqlmodel import Session, create_engine

_engine = None


def init_engine(db_url: str):
    global _engine
    _engine = create_engine(db_url, connect_args={"check_same_thread": False})
    return _engine


def get_engine():
    if _engine is None:
        raise RuntimeError("Engine not initialized; call init_engine() first")
    return _engine


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
```

- [ ] **Step 6: Run test, expect pass**

```
pytest tests/unit/test_models.py -v
```
Expected: PASS.

- [ ] **Step 7: Commit**

```
git add backend/app/db backend/tests/unit/test_models.py
git commit -m "feat(db): SQLModel schema for recipes, test_runs, test_loops"
```

---

### Task 5: Alembic migrations

**Files:**
- Create: `backend/alembic.ini`, `backend/app/db/migrations/env.py`, `backend/app/db/migrations/script.py.mako`, `backend/app/db/migrations/versions/0001_initial.py`

- [ ] **Step 1: Create `backend/alembic.ini`**

```ini
[alembic]
script_location = app/db/migrations
prepend_sys_path = .
sqlalchemy.url = sqlite:///../data/pinch.db

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 2: Create `backend/app/db/migrations/env.py`**

```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from app.db import models  # noqa: F401  (register tables)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def run_migrations_offline():
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 3: Create `backend/app/db/migrations/script.py.mako`**

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade():
    ${upgrades if upgrades else "pass"}


def downgrade():
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 4: Create initial migration `backend/app/db/migrations/versions/0001_initial.py`**

```python
"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "recipes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sqlmodel.AutoString(), nullable=False, unique=True),
        sa.Column("description", sqlmodel.AutoString(), nullable=True),
        sa.Column("position_mm", sa.Float(), nullable=False),
        sa.Column("speed_mms", sa.Float(), nullable=False),
        sa.Column("clamp_threshold_n", sa.Float(), nullable=False),
        sa.Column("loop_count", sa.Integer(), nullable=False),
        sa.Column("min_force_n", sa.Float(), nullable=True),
        sa.Column("max_force_n", sa.Float(), nullable=True),
        sa.Column("hold_time_ms", sa.Integer(), nullable=True),
        sa.Column("sampling_hz", sa.Integer(), nullable=False),
        sa.Column("created_at", sqlmodel.AutoString(), nullable=False),
        sa.Column("updated_at", sqlmodel.AutoString(), nullable=False),
    )
    op.create_index("ix_recipes_name", "recipes", ["name"], unique=True)

    op.create_table(
        "test_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("recipe_id", sa.Integer(), sa.ForeignKey("recipes.id"), nullable=False),
        sa.Column("operator", sqlmodel.AutoString(), nullable=True),
        sa.Column("batch_id", sqlmodel.AutoString(), nullable=True),
        sa.Column("shift", sqlmodel.AutoString(), nullable=True),
        sa.Column("started_at", sqlmodel.AutoString(), nullable=False),
        sa.Column("finished_at", sqlmodel.AutoString(), nullable=True),
        sa.Column("status", sqlmodel.AutoString(), nullable=False),
        sa.Column("abort_reason", sqlmodel.AutoString(), nullable=True),
        sa.Column("loops_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("waveform_dir", sqlmodel.AutoString(), nullable=True),
    )
    op.create_index("ix_runs_started", "test_runs", ["started_at"])
    op.create_index("ix_runs_recipe_id", "test_runs", ["recipe_id"])

    op.create_table(
        "test_loops",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("test_runs.id"), nullable=False),
        sa.Column("loop_index", sa.Integer(), nullable=False),
        sa.Column("started_at", sqlmodel.AutoString(), nullable=False),
        sa.Column("finished_at", sqlmodel.AutoString(), nullable=True),
        sa.Column("peak_force_n", sa.Float(), nullable=True),
        sa.Column("avg_force_n", sa.Float(), nullable=True),
        sa.Column("hold_time_ms", sa.Integer(), nullable=True),
        sa.Column("judgment", sqlmodel.AutoString(), nullable=True),
        sa.Column("waveform_file", sqlmodel.AutoString(), nullable=True),
    )
    op.create_index("ix_loops_run", "test_loops", ["run_id", "loop_index"])


def downgrade():
    op.drop_index("ix_loops_run", table_name="test_loops")
    op.drop_table("test_loops")
    op.drop_index("ix_runs_started", table_name="test_runs")
    op.drop_index("ix_runs_recipe_id", table_name="test_runs")
    op.drop_table("test_runs")
    op.drop_index("ix_recipes_name", table_name="recipes")
    op.drop_table("recipes")
```

- [ ] **Step 5: Run migration**

From `backend/`:
```
mkdir -p ..\data
alembic upgrade head
```
Expected: `INFO  [alembic.runtime.migration] Running upgrade  -> 0001`.

- [ ] **Step 6: Commit**

```
git add backend/alembic.ini backend/app/db/migrations
git commit -m "feat(db): alembic migrations with initial schema"
```

---

### Task 6: Recipe schemas + service + REST API

**Files:**
- Create: `backend/app/schemas/__init__.py`, `backend/app/schemas/recipe.py`, `backend/app/services/__init__.py`, `backend/app/services/recipe_service.py`, `backend/app/api/__init__.py`, `backend/app/api/recipes.py`
- Test: `backend/tests/unit/test_recipe_service.py`, `backend/tests/integration/__init__.py`, `backend/tests/integration/test_recipes_api.py`

- [ ] **Step 1: Write failing unit test `tests/unit/test_recipe_service.py`**

```python
from sqlmodel import Session, SQLModel, create_engine

from app.schemas.recipe import RecipeCreate, RecipeUpdate
from app.services.recipe_service import RecipeService


def _session():
    e = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(e)
    return Session(e)


def test_create_and_get_recipe():
    s = _session()
    svc = RecipeService(s)
    created = svc.create(RecipeCreate(
        name="r1",
        position_mm=10.0,
        speed_mms=5.0,
        clamp_threshold_n=7.0,
        loop_count=3,
    ))
    assert created.id is not None
    got = svc.get(created.id)
    assert got.name == "r1"


def test_update_recipe():
    s = _session()
    svc = RecipeService(s)
    r = svc.create(RecipeCreate(
        name="r2", position_mm=10.0, speed_mms=5.0, clamp_threshold_n=7.0, loop_count=3
    ))
    updated = svc.update(r.id, RecipeUpdate(loop_count=10))
    assert updated.loop_count == 10


def test_delete_recipe():
    s = _session()
    svc = RecipeService(s)
    r = svc.create(RecipeCreate(
        name="r3", position_mm=10.0, speed_mms=5.0, clamp_threshold_n=7.0, loop_count=3
    ))
    svc.delete(r.id)
    assert svc.get(r.id) is None


def test_list_recipes_sorted():
    s = _session()
    svc = RecipeService(s)
    svc.create(RecipeCreate(name="b", position_mm=1, speed_mms=1, clamp_threshold_n=1, loop_count=1))
    svc.create(RecipeCreate(name="a", position_mm=1, speed_mms=1, clamp_threshold_n=1, loop_count=1))
    items = svc.list_all()
    assert [r.name for r in items] == ["a", "b"]
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_recipe_service.py -v
```
Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `app/schemas/recipe.py`**

```python
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, model_validator


class RecipeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    position_mm: float = Field(..., gt=0)
    speed_mms: float = Field(..., gt=0)
    clamp_threshold_n: float = Field(..., gt=0)
    loop_count: int = Field(..., ge=1)
    min_force_n: Optional[float] = Field(default=None, ge=0)
    max_force_n: Optional[float] = Field(default=None, ge=0)
    hold_time_ms: Optional[int] = Field(default=None, ge=0)
    sampling_hz: int = Field(default=50, ge=1, le=1000)

    @model_validator(mode="after")
    def check_min_max(self):
        if self.min_force_n is not None and self.max_force_n is not None:
            if self.min_force_n > self.max_force_n:
                raise ValueError("min_force_n must be <= max_force_n")
        return self


class RecipeCreate(RecipeBase):
    pass


class RecipeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    position_mm: Optional[float] = Field(default=None, gt=0)
    speed_mms: Optional[float] = Field(default=None, gt=0)
    clamp_threshold_n: Optional[float] = Field(default=None, gt=0)
    loop_count: Optional[int] = Field(default=None, ge=1)
    min_force_n: Optional[float] = Field(default=None, ge=0)
    max_force_n: Optional[float] = Field(default=None, ge=0)
    hold_time_ms: Optional[int] = Field(default=None, ge=0)
    sampling_hz: Optional[int] = Field(default=None, ge=1, le=1000)


class RecipeRead(RecipeBase):
    id: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Implement `app/services/recipe_service.py`**

```python
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlmodel import Session, select

from app.db.models import Recipe
from app.schemas.recipe import RecipeCreate, RecipeUpdate


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class RecipeService:
    def __init__(self, session: Session):
        self.session = session

    def create(self, data: RecipeCreate) -> Recipe:
        now = _utcnow()
        r = Recipe(**data.model_dump(), created_at=now, updated_at=now)
        self.session.add(r)
        self.session.commit()
        self.session.refresh(r)
        return r

    def get(self, recipe_id: int) -> Optional[Recipe]:
        return self.session.get(Recipe, recipe_id)

    def list_all(self) -> List[Recipe]:
        return list(self.session.exec(select(Recipe).order_by(Recipe.name)).all())

    def update(self, recipe_id: int, data: RecipeUpdate) -> Recipe:
        r = self.get(recipe_id)
        if r is None:
            raise KeyError(recipe_id)
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(r, k, v)
        r.updated_at = _utcnow()
        self.session.add(r)
        self.session.commit()
        self.session.refresh(r)
        return r

    def delete(self, recipe_id: int) -> None:
        r = self.get(recipe_id)
        if r is None:
            return
        self.session.delete(r)
        self.session.commit()
```

- [ ] **Step 5: Create `app/schemas/__init__.py`, `app/services/__init__.py`, `app/api/__init__.py`** (empty files)

- [ ] **Step 6: Run unit test, expect pass**

```
pytest tests/unit/test_recipe_service.py -v
```
Expected: PASS (4 tests).

- [ ] **Step 7: Implement `app/api/recipes.py`**

```python
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.db.engine import get_session
from app.schemas.recipe import RecipeCreate, RecipeRead, RecipeUpdate
from app.services.recipe_service import RecipeService

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("", response_model=List[RecipeRead])
def list_recipes(session: Session = Depends(get_session)):
    return RecipeService(session).list_all()


@router.post("", response_model=RecipeRead, status_code=status.HTTP_201_CREATED)
def create_recipe(data: RecipeCreate, session: Session = Depends(get_session)):
    return RecipeService(session).create(data)


@router.get("/{recipe_id}", response_model=RecipeRead)
def get_recipe(recipe_id: int, session: Session = Depends(get_session)):
    r = RecipeService(session).get(recipe_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return r


@router.put("/{recipe_id}", response_model=RecipeRead)
def update_recipe(recipe_id: int, data: RecipeUpdate, session: Session = Depends(get_session)):
    try:
        return RecipeService(session).update(recipe_id, data)
    except KeyError:
        raise HTTPException(status_code=404, detail="Recipe not found")


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(recipe_id: int, session: Session = Depends(get_session)):
    RecipeService(session).delete(recipe_id)
    return None
```

- [ ] **Step 8: Write integration test `tests/integration/test_recipes_api.py`**

```python
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)
    monkeypatch.setattr(db_engine, "_engine", test_engine)
    app = build_app(test_mode=True)
    return TestClient(app)


def test_create_list_get_update_delete_recipe(client):
    payload = {
        "name": "tape-test",
        "position_mm": 25.0,
        "speed_mms": 10.0,
        "clamp_threshold_n": 7.0,
        "loop_count": 5,
    }
    r = client.post("/api/recipes", json=payload)
    assert r.status_code == 201
    body = r.json()
    recipe_id = body["id"]

    r = client.get("/api/recipes")
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = client.get(f"/api/recipes/{recipe_id}")
    assert r.status_code == 200
    assert r.json()["name"] == "tape-test"

    r = client.put(f"/api/recipes/{recipe_id}", json={"loop_count": 10})
    assert r.status_code == 200
    assert r.json()["loop_count"] == 10

    r = client.delete(f"/api/recipes/{recipe_id}")
    assert r.status_code == 204

    r = client.get(f"/api/recipes/{recipe_id}")
    assert r.status_code == 404


def test_validation_errors(client):
    bad = {"name": "x", "position_mm": -1, "speed_mms": 5, "clamp_threshold_n": 5, "loop_count": 1}
    r = client.post("/api/recipes", json=bad)
    assert r.status_code == 422
```

(`tests/integration/__init__.py` — empty file)

- [ ] **Step 9: Run integration test, expect failure (no `build_app` yet)**

```
pytest tests/integration/test_recipes_api.py -v
```
Expected: ImportError on `app.main.build_app`.

- [ ] **Step 10: Stub `app/main.py`** (full impl in Task 13; minimal stub to unblock tests)

```python
from __future__ import annotations

from fastapi import FastAPI

from app.api import recipes


def build_app(test_mode: bool = False) -> FastAPI:
    app = FastAPI(title="Pinch Test MC")
    app.include_router(recipes.router)
    return app


app = build_app()
```

- [ ] **Step 11: Run integration test, expect pass**

```
pytest tests/integration/test_recipes_api.py -v
```
Expected: 2 tests PASS.

- [ ] **Step 12: Commit**

```
git add backend/app/schemas backend/app/services backend/app/api backend/app/main.py backend/tests
git commit -m "feat(recipes): CRUD service + REST API with validation"
```

---

### Task 7: Hardware base protocols + dataclasses

**Files:**
- Create: `backend/app/hardware/__init__.py`, `backend/app/hardware/base.py`
- Test: `backend/tests/unit/test_hardware_base.py`

- [ ] **Step 1: Write failing test `tests/unit/test_hardware_base.py`**

```python
import time

from app.hardware.base import ImadaReading, Esp32Reading, PlcEvent


def test_imada_reading_dataclass():
    r = ImadaReading(timestamp_ns=time.monotonic_ns(), force_n=1.23)
    assert r.force_n == 1.23


def test_esp32_reading_dataclass():
    r = Esp32Reading(timestamp_ns=time.monotonic_ns(), force_n=4.5, raw=1234)
    assert r.raw == 1234


def test_plc_event_bit_edge():
    e = PlcEvent.bit(addr=5, value=True)
    assert e.kind == "bit"
    assert e.addr == 5
    assert e.value is True
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_hardware_base.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `app/hardware/base.py`**

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal, Protocol, runtime_checkable


@dataclass(frozen=True)
class ImadaReading:
    timestamp_ns: int
    force_n: float
    unit: str = "N"


@dataclass(frozen=True)
class Esp32Reading:
    timestamp_ns: int
    force_n: float
    raw: int


@dataclass(frozen=True)
class PlcEvent:
    kind: Literal["bit", "word"]
    addr: int
    value: int | bool
    timestamp_ns: int = 0

    @staticmethod
    def bit(addr: int, value: bool, timestamp_ns: int = 0) -> "PlcEvent":
        return PlcEvent(kind="bit", addr=addr, value=value, timestamp_ns=timestamp_ns)

    @staticmethod
    def word(addr: int, value: int, timestamp_ns: int = 0) -> "PlcEvent":
        return PlcEvent(kind="word", addr=addr, value=value, timestamp_ns=timestamp_ns)


@runtime_checkable
class PlcClient(Protocol):
    @property
    def is_connected(self) -> bool: ...
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
    def write_word(self, addr: int, value: int) -> None: ...
    def read_word(self, addr: int) -> int: ...
    def set_bit(self, addr: int, on: bool) -> None: ...
    def read_bit(self, addr: int) -> bool: ...


@runtime_checkable
class ImadaClient(Protocol):
    @property
    def is_connected(self) -> bool: ...
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...


@runtime_checkable
class Esp32Client(Protocol):
    @property
    def is_connected(self) -> bool: ...
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
```

- [ ] **Step 4: Create `app/hardware/__init__.py`** (empty)

- [ ] **Step 5: Run test, expect pass**

```
pytest tests/unit/test_hardware_base.py -v
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```
git add backend/app/hardware/__init__.py backend/app/hardware/base.py backend/tests/unit/test_hardware_base.py
git commit -m "feat(hardware): base protocols + reading/event dataclasses"
```

---

### Task 8: Mock PLC driver

**Files:**
- Create: `backend/app/hardware/mock/__init__.py`, `backend/app/hardware/mock/mock_plc.py`
- Test: `backend/tests/unit/test_mock_plc.py`

- [ ] **Step 1: Write failing test `tests/unit/test_mock_plc.py`**

```python
import time

from app.hardware.mock.mock_plc import MockPlc, MockPlcScript


def test_mock_plc_word_and_bit():
    plc = MockPlc()
    plc.connect()
    plc.write_word(100, 2500)
    assert plc.read_word(100) == 2500
    plc.set_bit(3, True)
    assert plc.read_bit(3) is True
    plc.disconnect()


def test_mock_plc_script_emits_bits_in_order():
    script = MockPlcScript(
        after_b3_to_b5_ms=10,
        after_b5_to_b6_ms=20,
        after_b6_to_b7_ms=10,
    )
    plc = MockPlc(script=script)
    plc.connect()
    events = []
    plc.subscribe(lambda evt: events.append(evt))
    # When B3 set, mock should schedule B5/B6/B7 emissions.
    plc.set_bit(3, True)
    time.sleep(0.2)
    bits = [(e.addr, e.value) for e in events if e.kind == "bit"]
    assert (5, True) in bits
    assert (6, True) in bits
    assert (7, True) in bits
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_mock_plc.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `app/hardware/mock/mock_plc.py`**

```python
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from app.hardware.base import PlcEvent


@dataclass
class MockPlcScript:
    """Optional script that auto-emits PLC bits to simulate the rig.

    after_b3_to_b5_ms: delay between B3 being set and B5 turning on
    after_b5_to_b6_ms: delay between B5 and B6 turning on (tension check)
    after_b6_to_b7_ms: delay between final loop B6 and B7 (finish)
    """

    after_b3_to_b5_ms: int = 50
    after_b5_to_b6_ms: int = 200
    after_b6_to_b7_ms: int = 50
    final_b7: bool = True


class MockPlc:
    def __init__(self, script: Optional[MockPlcScript] = None):
        self._words: Dict[int, int] = {}
        self._bits: Dict[int, bool] = {}
        self._lock = threading.Lock()
        self._subs: List[Callable[[PlcEvent], None]] = []
        self._connected = False
        self._script = script

    @property
    def is_connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def subscribe(self, cb: Callable[[PlcEvent], None]) -> None:
        self._subs.append(cb)

    def _emit(self, evt: PlcEvent) -> None:
        for s in self._subs:
            try:
                s(evt)
            except Exception:
                pass

    def write_word(self, addr: int, value: int) -> None:
        with self._lock:
            self._words[addr] = value
        self._emit(PlcEvent.word(addr, value, time.monotonic_ns()))

    def read_word(self, addr: int) -> int:
        with self._lock:
            return self._words.get(addr, 0)

    def set_bit(self, addr: int, on: bool) -> None:
        with self._lock:
            prev = self._bits.get(addr, False)
            self._bits[addr] = on
        if prev != on:
            self._emit(PlcEvent.bit(addr, on, time.monotonic_ns()))
            if self._script is not None and addr == 3 and on:
                threading.Thread(target=self._run_script, daemon=True).start()

    def read_bit(self, addr: int) -> bool:
        with self._lock:
            return self._bits.get(addr, False)

    def _run_script(self) -> None:
        time.sleep(self._script.after_b3_to_b5_ms / 1000)
        self.set_bit(5, True)
        time.sleep(self._script.after_b5_to_b6_ms / 1000)
        self.set_bit(6, True)
        time.sleep(self._script.after_b6_to_b7_ms / 1000)
        if self._script.final_b7:
            self.set_bit(7, True)
```

- [ ] **Step 4: Create `app/hardware/mock/__init__.py`** (empty)

- [ ] **Step 5: Run test, expect pass**

```
pytest tests/unit/test_mock_plc.py -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add backend/app/hardware/mock backend/tests/unit/test_mock_plc.py
git commit -m "feat(hardware): mock PLC with scripted B3->B5->B6->B7 emission"
```

---

### Task 9: Mock Imada force gauge

**Files:**
- Create: `backend/app/hardware/mock/mock_imada.py`
- Test: `backend/tests/unit/test_mock_imada.py`

- [ ] **Step 1: Write failing test `tests/unit/test_mock_imada.py`**

```python
import time

from app.hardware.mock.mock_imada import MockImada


def test_mock_imada_streams_at_target_rate():
    imada = MockImada(rate_hz=200, peak_n=8.0)
    imada.connect()
    samples = []
    imada.subscribe(lambda r: samples.append(r))
    imada.start_stream()
    time.sleep(0.3)
    imada.stop_stream()
    imada.disconnect()
    # Allow a wide tolerance: 200 Hz for 0.3 s ~= 60 samples, accept 30+
    assert len(samples) >= 30
    forces = [s.force_n for s in samples]
    assert max(forces) <= 8.5
    assert min(forces) >= -0.5
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_mock_imada.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `app/hardware/mock/mock_imada.py`**

```python
from __future__ import annotations

import math
import threading
import time
from typing import Callable, List, Optional

from app.hardware.base import ImadaReading


class MockImada:
    """Emits a synthetic sine half-wave to simulate a tensile pull."""

    def __init__(self, rate_hz: int = 100, peak_n: float = 8.0, period_ms: int = 1000):
        self.rate_hz = rate_hz
        self.peak_n = peak_n
        self.period_ms = period_ms
        self._subs: List[Callable[[ImadaReading], None]] = []
        self._connected = False
        self._stop_event: Optional[threading.Event] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self.stop_stream()
        self._connected = False

    def subscribe(self, cb: Callable[[ImadaReading], None]) -> None:
        self._subs.append(cb)

    def start_stream(self) -> None:
        if self._thread is not None:
            return
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop_stream(self) -> None:
        if self._stop_event:
            self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1)
            self._thread = None
            self._stop_event = None

    def _run(self) -> None:
        period_s = self.period_ms / 1000.0
        interval = 1.0 / self.rate_hz
        t0 = time.monotonic()
        while self._stop_event and not self._stop_event.is_set():
            t = time.monotonic() - t0
            phase = (t % period_s) / period_s
            force = self.peak_n * math.sin(math.pi * phase)  # 0..peak..0 over one period
            reading = ImadaReading(timestamp_ns=time.monotonic_ns(), force_n=force)
            for s in self._subs:
                try:
                    s(reading)
                except Exception:
                    pass
            time.sleep(interval)
```

- [ ] **Step 4: Run test, expect pass**

```
pytest tests/unit/test_mock_imada.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/app/hardware/mock/mock_imada.py backend/tests/unit/test_mock_imada.py
git commit -m "feat(hardware): mock Imada force gauge emitting sine wave"
```

---

### Task 10: Mock ESP32 sensor

**Files:**
- Create: `backend/app/hardware/mock/mock_esp32.py`
- Test: `backend/tests/unit/test_mock_esp32.py`

- [ ] **Step 1: Write failing test `tests/unit/test_mock_esp32.py`**

```python
import time

from app.hardware.mock.mock_esp32 import MockEsp32


def test_mock_esp32_ramps_to_target():
    esp = MockEsp32(rate_hz=200, target_n=7.0, ramp_ms=300, slope=0.01, offset=0.0)
    esp.connect()
    samples = []
    esp.subscribe(lambda r: samples.append(r))
    esp.start_stream()
    time.sleep(0.5)
    esp.stop_stream()
    esp.disconnect()
    forces = [s.force_n for s in samples]
    # After 0.5s the ramp should have reached or exceeded the target.
    assert forces[-1] >= 6.5
    assert all(f >= 0 for f in forces)
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_mock_esp32.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `app/hardware/mock/mock_esp32.py`**

```python
from __future__ import annotations

import threading
import time
from typing import Callable, List, Optional

from app.hardware.base import Esp32Reading


class MockEsp32:
    """Emits a ramp from 0 to target_n over ramp_ms and then holds."""

    def __init__(
        self,
        rate_hz: int = 100,
        target_n: float = 7.0,
        ramp_ms: int = 500,
        slope: float = 0.01,
        offset: float = 0.0,
    ):
        self.rate_hz = rate_hz
        self.target_n = target_n
        self.ramp_ms = ramp_ms
        self.slope = slope
        self.offset = offset
        self._subs: List[Callable[[Esp32Reading], None]] = []
        self._connected = False
        self._stop_event: Optional[threading.Event] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self.stop_stream()
        self._connected = False

    def subscribe(self, cb: Callable[[Esp32Reading], None]) -> None:
        self._subs.append(cb)

    def start_stream(self) -> None:
        if self._thread is not None:
            return
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop_stream(self) -> None:
        if self._stop_event:
            self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1)
            self._thread = None
            self._stop_event = None

    def _run(self) -> None:
        ramp_s = self.ramp_ms / 1000.0
        interval = 1.0 / self.rate_hz
        t0 = time.monotonic()
        while self._stop_event and not self._stop_event.is_set():
            t = time.monotonic() - t0
            if t < ramp_s:
                force = self.target_n * (t / ramp_s)
            else:
                force = self.target_n
            # invert calibration: raw = (force - offset) / slope (so that Real driver could use same)
            raw = int((force - self.offset) / self.slope) if self.slope != 0 else 0
            reading = Esp32Reading(timestamp_ns=time.monotonic_ns(), force_n=force, raw=raw)
            for s in self._subs:
                try:
                    s(reading)
                except Exception:
                    pass
            time.sleep(interval)
```

- [ ] **Step 4: Run test, expect pass**

```
pytest tests/unit/test_mock_esp32.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/app/hardware/mock/mock_esp32.py backend/tests/unit/test_mock_esp32.py
git commit -m "feat(hardware): mock ESP32 sensor with linear ramp"
```

---

### Task 11: Event bus (in-process async pub/sub)

**Files:**
- Create: `backend/app/services/event_bus.py`
- Test: `backend/tests/unit/test_event_bus.py`

- [ ] **Step 1: Write failing test `tests/unit/test_event_bus.py`**

```python
import asyncio

import pytest

from app.services.event_bus import EventBus


@pytest.mark.asyncio
async def test_publish_to_subscribers():
    bus = EventBus()
    received = []
    q = await bus.subscribe()

    async def consume():
        msg = await q.get()
        received.append(msg)

    task = asyncio.create_task(consume())
    await bus.publish({"type": "hello", "n": 1})
    await asyncio.wait_for(task, timeout=1)
    assert received == [{"type": "hello", "n": 1}]


@pytest.mark.asyncio
async def test_unsubscribe_after_drop():
    bus = EventBus()
    q = await bus.subscribe()
    await bus.unsubscribe(q)
    await bus.publish({"type": "x"})
    # Queue should remain empty since we unsubscribed.
    assert q.empty()
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_event_bus.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `app/services/event_bus.py`**

```python
from __future__ import annotations

import asyncio
from typing import Any, List


class EventBus:
    def __init__(self) -> None:
        self._subscribers: List[asyncio.Queue] = []
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        async with self._lock:
            self._subscribers.append(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue) -> None:
        async with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    async def publish(self, msg: dict[str, Any]) -> None:
        async with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # Drop oldest
                try:
                    q.get_nowait()
                except Exception:
                    pass
                try:
                    q.put_nowait(msg)
                except Exception:
                    pass
```

- [ ] **Step 4: Run test, expect pass**

```
pytest tests/unit/test_event_bus.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/app/services/event_bus.py backend/tests/unit/test_event_bus.py
git commit -m "feat(services): async in-process event bus with backpressure drop-oldest"
```

---

### Task 12: State machine (pure logic, no I/O)

**Files:**
- Create: `backend/app/services/state_machine.py`
- Test: `backend/tests/unit/test_state_machine.py`

- [ ] **Step 1: Write failing test `tests/unit/test_state_machine.py`**

```python
from app.services.state_machine import Event, RunMode, State, StateMachine


def test_full_happy_path_auto_mode():
    sm = StateMachine(loop_count=2, mode=RunMode.AUTO)
    assert sm.state == State.IDLE

    sm.dispatch(Event.START)
    assert sm.state == State.WRITE_PLC_PARAMS

    sm.dispatch(Event.PARAMS_WRITTEN)
    assert sm.state == State.LOOP_BEGIN

    sm.dispatch(Event.AUTO_TRIGGER_CLAMP)
    assert sm.state == State.CLAMP_PRESSED

    sm.dispatch(Event.CLAMP_PRESSED_ACK)
    assert sm.state == State.WAIT_CLAMP_FORCE

    sm.dispatch(Event.CLAMP_FORCE_REACHED)
    assert sm.state == State.WAIT_B5

    sm.dispatch(Event.B5_RECEIVED)
    assert sm.state == State.TENSION_CHECK

    sm.dispatch(Event.B6_RECEIVED)
    assert sm.state == State.EVALUATE

    sm.dispatch(Event.EVALUATION_DONE)
    assert sm.state == State.UNCLAMP

    sm.dispatch(Event.UNCLAMP_DONE)
    assert sm.state == State.LOOP_BEGIN   # loop_index = 2 < loop_count

    # second loop
    sm.dispatch(Event.AUTO_TRIGGER_CLAMP)
    sm.dispatch(Event.CLAMP_PRESSED_ACK)
    sm.dispatch(Event.CLAMP_FORCE_REACHED)
    sm.dispatch(Event.B5_RECEIVED)
    sm.dispatch(Event.B6_RECEIVED)
    sm.dispatch(Event.EVALUATION_DONE)
    sm.dispatch(Event.UNCLAMP_DONE)
    assert sm.state == State.DONE_B7  # all loops done

    sm.dispatch(Event.B7_RECEIVED)
    assert sm.state == State.IDLE


def test_manual_mode_waits_for_clamp_command():
    sm = StateMachine(loop_count=1, mode=RunMode.MANUAL)
    sm.dispatch(Event.START)
    sm.dispatch(Event.PARAMS_WRITTEN)
    assert sm.state == State.LOOP_BEGIN

    # No transition without explicit MANUAL_CLAMP_REQUESTED.
    sm.dispatch(Event.AUTO_TRIGGER_CLAMP)
    assert sm.state == State.LOOP_BEGIN

    sm.dispatch(Event.MANUAL_CLAMP_REQUESTED)
    assert sm.state == State.CLAMP_PRESSED


def test_abort_from_any_state():
    sm = StateMachine(loop_count=10, mode=RunMode.AUTO)
    sm.dispatch(Event.START)
    sm.dispatch(Event.PARAMS_WRITTEN)
    sm.dispatch(Event.AUTO_TRIGGER_CLAMP)
    sm.dispatch(Event.CLAMP_PRESSED_ACK)
    sm.dispatch(Event.ABORT)
    assert sm.state == State.ABORTED


def test_reset_returns_to_idle():
    sm = StateMachine(loop_count=1, mode=RunMode.AUTO)
    sm.dispatch(Event.START)
    sm.dispatch(Event.ABORT)
    assert sm.state == State.ABORTED
    sm.dispatch(Event.RESET)
    assert sm.state == State.IDLE


def test_error_event_transitions_to_error():
    sm = StateMachine(loop_count=1, mode=RunMode.AUTO)
    sm.dispatch(Event.START)
    sm.dispatch(Event.ERROR)
    assert sm.state == State.ERROR
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_state_machine.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `app/services/state_machine.py`**

```python
from __future__ import annotations

from enum import Enum
from typing import Callable, Dict, Optional, Tuple


class State(str, Enum):
    IDLE = "IDLE"
    WRITE_PLC_PARAMS = "WRITE_PLC_PARAMS"
    LOOP_BEGIN = "LOOP_BEGIN"
    CLAMP_PRESSED = "CLAMP_PRESSED"
    WAIT_CLAMP_FORCE = "WAIT_CLAMP_FORCE"
    WAIT_B5 = "WAIT_B5"
    TENSION_CHECK = "TENSION_CHECK"
    EVALUATE = "EVALUATE"
    UNCLAMP = "UNCLAMP"
    DONE_B7 = "DONE_B7"
    ABORTED = "ABORTED"
    ERROR = "ERROR"


class Event(str, Enum):
    START = "START"
    PARAMS_WRITTEN = "PARAMS_WRITTEN"
    AUTO_TRIGGER_CLAMP = "AUTO_TRIGGER_CLAMP"
    MANUAL_CLAMP_REQUESTED = "MANUAL_CLAMP_REQUESTED"
    CLAMP_PRESSED_ACK = "CLAMP_PRESSED_ACK"
    CLAMP_FORCE_REACHED = "CLAMP_FORCE_REACHED"
    B5_RECEIVED = "B5_RECEIVED"
    B6_RECEIVED = "B6_RECEIVED"
    EVALUATION_DONE = "EVALUATION_DONE"
    UNCLAMP_DONE = "UNCLAMP_DONE"
    B7_RECEIVED = "B7_RECEIVED"
    ABORT = "ABORT"
    RESET = "RESET"
    ERROR = "ERROR"


class RunMode(str, Enum):
    AUTO = "auto"
    MANUAL = "manual"


_TRANSITIONS: Dict[Tuple[State, Event], State] = {
    (State.IDLE, Event.START): State.WRITE_PLC_PARAMS,
    (State.WRITE_PLC_PARAMS, Event.PARAMS_WRITTEN): State.LOOP_BEGIN,
    (State.CLAMP_PRESSED, Event.CLAMP_PRESSED_ACK): State.WAIT_CLAMP_FORCE,
    (State.WAIT_CLAMP_FORCE, Event.CLAMP_FORCE_REACHED): State.WAIT_B5,
    (State.WAIT_B5, Event.B5_RECEIVED): State.TENSION_CHECK,
    (State.TENSION_CHECK, Event.B6_RECEIVED): State.EVALUATE,
    (State.EVALUATE, Event.EVALUATION_DONE): State.UNCLAMP,
    (State.DONE_B7, Event.B7_RECEIVED): State.IDLE,
}


class StateMachine:
    def __init__(self, loop_count: int, mode: RunMode):
        self.state: State = State.IDLE
        self.loop_count = loop_count
        self.mode = mode
        self.current_loop = 0
        self._listeners: list[Callable[[State, State, Event], None]] = []

    def add_listener(self, fn: Callable[[State, State, Event], None]) -> None:
        self._listeners.append(fn)

    def dispatch(self, event: Event) -> Optional[State]:
        # Global transitions (work from any non-terminal state)
        if event == Event.ABORT and self.state not in (State.IDLE,):
            return self._transition(State.ABORTED, event)
        if event == Event.RESET and self.state in (State.ABORTED, State.ERROR):
            self.current_loop = 0
            return self._transition(State.IDLE, event)
        if event == Event.ERROR:
            return self._transition(State.ERROR, event)

        # Specific transitions
        if self.state == State.LOOP_BEGIN:
            if event == Event.AUTO_TRIGGER_CLAMP and self.mode == RunMode.AUTO:
                self.current_loop += 1
                return self._transition(State.CLAMP_PRESSED, event)
            if event == Event.MANUAL_CLAMP_REQUESTED and self.mode == RunMode.MANUAL:
                self.current_loop += 1
                return self._transition(State.CLAMP_PRESSED, event)
            return None
        if self.state == State.UNCLAMP and event == Event.UNCLAMP_DONE:
            if self.current_loop < self.loop_count:
                return self._transition(State.LOOP_BEGIN, event)
            return self._transition(State.DONE_B7, event)

        key = (self.state, event)
        if key in _TRANSITIONS:
            return self._transition(_TRANSITIONS[key], event)
        return None

    def _transition(self, new_state: State, event: Event) -> State:
        old = self.state
        self.state = new_state
        for ln in self._listeners:
            try:
                ln(old, new_state, event)
            except Exception:
                pass
        return new_state
```

- [ ] **Step 4: Run test, expect pass**

```
pytest tests/unit/test_state_machine.py -v
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```
git add backend/app/services/state_machine.py backend/tests/unit/test_state_machine.py
git commit -m "feat(services): pure state machine for pinch test sequence"
```

---

### Task 13: Waveform service (PyArrow parquet)

**Files:**
- Create: `backend/app/services/waveform.py`
- Test: `backend/tests/unit/test_waveform.py`

- [ ] **Step 1: Write failing test `tests/unit/test_waveform.py`**

```python
from pathlib import Path

from app.services.waveform import WaveformService, WaveformSample


def test_write_and_read_waveform(tmp_path: Path):
    svc = WaveformService(base_dir=tmp_path)
    samples = [
        WaveformSample(t_ms=0, force_n=0.0),
        WaveformSample(t_ms=10, force_n=1.5),
        WaveformSample(t_ms=20, force_n=3.2),
    ]
    path = svc.write_loop(run_id=42, loop_index=1, samples=samples)
    assert path.exists()
    rel = svc.relative_path(path)
    assert rel.endswith("loop_001.parquet")

    arr = svc.read_loop(run_id=42, loop_index=1)
    assert arr["t_ms"] == [0, 10, 20]
    assert arr["force_n"] == [0.0, 1.5, 3.2]


def test_loop_summary(tmp_path: Path):
    svc = WaveformService(base_dir=tmp_path)
    samples = [
        WaveformSample(t_ms=i * 10, force_n=float(i % 5))
        for i in range(50)
    ]
    summary = svc.summarize(samples, min_force_n=2.0)
    assert summary.peak_force_n == 4.0
    assert summary.avg_force_n > 0
    assert summary.hold_time_ms >= 0
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_waveform.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `app/services/waveform.py`**

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

import pyarrow as pa
import pyarrow.parquet as pq


@dataclass(frozen=True)
class WaveformSample:
    t_ms: int
    force_n: float


@dataclass(frozen=True)
class LoopSummary:
    peak_force_n: float
    avg_force_n: float
    hold_time_ms: int


class WaveformService:
    def __init__(self, base_dir: Path | str):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _run_dir(self, run_id: int) -> Path:
        p = self.base_dir / str(run_id)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _loop_path(self, run_id: int, loop_index: int) -> Path:
        return self._run_dir(run_id) / f"loop_{loop_index:03d}.parquet"

    def write_loop(self, run_id: int, loop_index: int, samples: Sequence[WaveformSample]) -> Path:
        path = self._loop_path(run_id, loop_index)
        table = pa.table({
            "t_ms": pa.array([s.t_ms for s in samples], type=pa.uint32()),
            "force_n": pa.array([s.force_n for s in samples], type=pa.float32()),
        })
        pq.write_table(table, path)
        return path

    def read_loop(self, run_id: int, loop_index: int) -> dict:
        table = pq.read_table(self._loop_path(run_id, loop_index))
        return {
            "t_ms": table.column("t_ms").to_pylist(),
            "force_n": table.column("force_n").to_pylist(),
        }

    def relative_path(self, abs_path: Path) -> str:
        return str(abs_path.relative_to(self.base_dir.parent)) if self.base_dir.parent in abs_path.parents else str(abs_path)

    def summarize(self, samples: Sequence[WaveformSample], min_force_n: Optional[float]) -> LoopSummary:
        if not samples:
            return LoopSummary(peak_force_n=0.0, avg_force_n=0.0, hold_time_ms=0)
        forces = [s.force_n for s in samples]
        peak = max(forces)
        avg = sum(forces) / len(forces)
        hold_ms = 0
        if min_force_n is not None:
            above = [s for s in samples if s.force_n >= min_force_n]
            if above:
                hold_ms = above[-1].t_ms - above[0].t_ms
        return LoopSummary(peak_force_n=peak, avg_force_n=avg, hold_time_ms=hold_ms)
```

- [ ] **Step 4: Run test, expect pass**

```
pytest tests/unit/test_waveform.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/app/services/waveform.py backend/tests/unit/test_waveform.py
git commit -m "feat(services): waveform service with parquet IO and loop summary"
```

---

### Task 14: HardwareManager (composes 3 drivers + lifecycle)

**Files:**
- Create: `backend/app/hardware/manager.py`
- Test: `backend/tests/unit/test_hardware_manager.py`

- [ ] **Step 1: Write failing test `tests/unit/test_hardware_manager.py`**

```python
import asyncio

import pytest

from app.config import (
    Esp32Calibration,
    Esp32Config,
    HardwareConfig,
    ImadaConfig,
    PlcConfig,
    Settings,
    ServerConfig,
    StateTimeouts,
    StorageConfig,
)
from app.hardware.manager import HardwareManager


def _settings(tmp_path) -> Settings:
    return Settings(
        hardware=HardwareConfig(
            plc=PlcConfig(),
            imada=ImadaConfig(),
            esp32=Esp32Config(calibration=Esp32Calibration(slope=0.01, offset=0.0)),
            state_timeouts=StateTimeouts(),
        ),
        storage=StorageConfig(db_url="sqlite:///./test.db", waveforms_dir=str(tmp_path)),
        server=ServerConfig(),
        mock_mode=True,
    )


@pytest.mark.asyncio
async def test_manager_starts_mocks_and_streams(tmp_path):
    mgr = HardwareManager(_settings(tmp_path))
    await mgr.start()
    try:
        # Imada and ESP32 streams should be available; trigger start.
        mgr.start_imada_stream()
        mgr.start_esp32_stream()
        await asyncio.sleep(0.1)
        # Drain a few samples from queues.
        got_imada = await asyncio.wait_for(mgr.imada_queue.get(), timeout=1)
        got_esp = await asyncio.wait_for(mgr.esp32_queue.get(), timeout=1)
        assert got_imada.force_n is not None
        assert got_esp.force_n is not None
    finally:
        await mgr.shutdown()
```

- [ ] **Step 2: Run test, expect failure**

```
pytest tests/unit/test_hardware_manager.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement `app/hardware/manager.py`**

```python
from __future__ import annotations

import asyncio
from typing import Optional

from app.config import Settings
from app.hardware.base import Esp32Reading, ImadaReading, PlcEvent
from app.hardware.mock.mock_esp32 import MockEsp32
from app.hardware.mock.mock_imada import MockImada
from app.hardware.mock.mock_plc import MockPlc, MockPlcScript


class HardwareManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.plc: Optional[MockPlc] = None
        self.imada: Optional[MockImada] = None
        self.esp32: Optional[MockEsp32] = None
        self.plc_event_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.imada_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.esp32_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        if self.settings.mock_mode:
            self.plc = MockPlc(script=MockPlcScript())
            self.imada = MockImada(rate_hz=100, peak_n=8.0, period_ms=1000)
            self.esp32 = MockEsp32(
                rate_hz=100,
                target_n=8.0,
                ramp_ms=500,
                slope=self.settings.hardware.esp32.calibration.slope,
                offset=self.settings.hardware.esp32.calibration.offset,
            )
        else:
            raise NotImplementedError("real drivers added in Plan 3")

        self.plc.connect()
        self.imada.connect()
        self.esp32.connect()

        self.plc.subscribe(self._on_plc_event)
        self.imada.subscribe(self._on_imada_reading)
        self.esp32.subscribe(self._on_esp32_reading)

    async def shutdown(self) -> None:
        if self.plc:
            self.plc.set_bit(1, True)  # B1 = stop
            self.plc.set_bit(2, True)  # B2 = reset
            self.plc.disconnect()
        if self.imada:
            self.imada.disconnect()
        if self.esp32:
            self.esp32.disconnect()

    def start_imada_stream(self) -> None:
        assert self.imada
        self.imada.start_stream()

    def stop_imada_stream(self) -> None:
        assert self.imada
        self.imada.stop_stream()

    def start_esp32_stream(self) -> None:
        assert self.esp32
        self.esp32.start_stream()

    def stop_esp32_stream(self) -> None:
        assert self.esp32
        self.esp32.stop_stream()

    def _on_plc_event(self, evt: PlcEvent) -> None:
        self._push(self.plc_event_queue, evt)

    def _on_imada_reading(self, r: ImadaReading) -> None:
        self._push(self.imada_queue, r)

    def _on_esp32_reading(self, r: Esp32Reading) -> None:
        self._push(self.esp32_queue, r)

    def _push(self, q: asyncio.Queue, item) -> None:
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(self._enqueue, q, item)

    @staticmethod
    def _enqueue(q: asyncio.Queue, item) -> None:
        try:
            q.put_nowait(item)
        except asyncio.QueueFull:
            try:
                q.get_nowait()
            except Exception:
                pass
            try:
                q.put_nowait(item)
            except Exception:
                pass
```

- [ ] **Step 4: Run test, expect pass**

```
pytest tests/unit/test_hardware_manager.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add backend/app/hardware/manager.py backend/tests/unit/test_hardware_manager.py
git commit -m "feat(hardware): HardwareManager composes mock drivers + asyncio bridge"
```

---

### Task 15: WebSocket hub + schemas

**Files:**
- Create: `backend/app/schemas/ws_messages.py`, `backend/app/services/ws_hub.py`, `backend/app/api/ws.py`
- Test: `backend/tests/unit/test_ws_hub.py`

- [ ] **Step 1: Implement `app/schemas/ws_messages.py`**

```python
from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field


class WsImadaBatch(BaseModel):
    type: Literal["imada_batch"] = "imada_batch"
    run_id: int
    loop: int
    samples: List[List[float]]  # [[t_ms, force_n], ...]


class WsEsp32Batch(BaseModel):
    type: Literal["esp32_batch"] = "esp32_batch"
    run_id: int
    samples: List[List[float]]


class WsStateChange(BaseModel):
    type: Literal["state_change"] = "state_change"
    run_id: int
    from_state: str = Field(alias="from")
    to_state: str = Field(alias="to")
    loop: Optional[int] = None
    at: str

    model_config = {"populate_by_name": True}


class WsPlcBit(BaseModel):
    type: Literal["plc_bit"] = "plc_bit"
    addr: int
    value: bool


class WsLoopResult(BaseModel):
    type: Literal["loop_result"] = "loop_result"
    run_id: int
    loop: int
    peak_force_n: float
    avg_force_n: float
    hold_time_ms: int
    judgment: str


class WsRunFinished(BaseModel):
    type: Literal["run_finished"] = "run_finished"
    run_id: int
    status: str
    loops_completed: int


class WsError(BaseModel):
    type: Literal["error"] = "error"
    source: str
    code: str
    message: str


class WsHwStatus(BaseModel):
    type: Literal["hw_status"] = "hw_status"
    device: str
    connected: bool
```

- [ ] **Step 2: Write failing test `tests/unit/test_ws_hub.py`**

```python
import asyncio

import pytest

from app.services.event_bus import EventBus
from app.services.ws_hub import WsHub


@pytest.mark.asyncio
async def test_hub_broadcasts_event_bus_messages():
    bus = EventBus()
    hub = WsHub(bus)

    received_a, received_b = [], []
    a, b = hub.register(), hub.register()

    async def consume(q, sink):
        for _ in range(2):
            sink.append(await q.get())

    task_a = asyncio.create_task(consume(a, received_a))
    task_b = asyncio.create_task(consume(b, received_b))

    pump_task = asyncio.create_task(hub.pump())
    await bus.publish({"type": "hello"})
    await bus.publish({"type": "world"})
    await asyncio.wait_for(asyncio.gather(task_a, task_b), timeout=1)
    pump_task.cancel()
    assert received_a == [{"type": "hello"}, {"type": "world"}]
    assert received_b == received_a
```

- [ ] **Step 3: Run test, expect failure**

```
pytest tests/unit/test_ws_hub.py -v
```
Expected: ModuleNotFoundError.

- [ ] **Step 4: Implement `app/services/ws_hub.py`**

```python
from __future__ import annotations

import asyncio
from typing import List

from app.services.event_bus import EventBus


class WsHub:
    def __init__(self, bus: EventBus):
        self.bus = bus
        self._clients: List[asyncio.Queue] = []

    def register(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._clients.append(q)
        return q

    def unregister(self, q: asyncio.Queue) -> None:
        if q in self._clients:
            self._clients.remove(q)

    async def pump(self) -> None:
        bus_q = await self.bus.subscribe()
        try:
            while True:
                msg = await bus_q.get()
                for client in list(self._clients):
                    try:
                        client.put_nowait(msg)
                    except asyncio.QueueFull:
                        try:
                            client.get_nowait()
                        except Exception:
                            pass
                        try:
                            client.put_nowait(msg)
                        except Exception:
                            pass
        finally:
            await self.bus.unsubscribe(bus_q)
```

- [ ] **Step 5: Run test, expect pass**

```
pytest tests/unit/test_ws_hub.py -v
```
Expected: PASS.

- [ ] **Step 6: Implement `app/api/ws.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import deps

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    hub = deps.get_ws_hub()
    q = hub.register()
    try:
        while True:
            msg = await q.get()
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        return
    finally:
        hub.unregister(q)
```

- [ ] **Step 7: Commit**

```
git add backend/app/schemas/ws_messages.py backend/app/services/ws_hub.py backend/app/api/ws.py backend/tests/unit/test_ws_hub.py
git commit -m "feat(ws): WebSocket hub + message schemas with bus pump"
```

---

### Task 16: deps.py — app-wide singletons (HardwareManager, EventBus, WsHub, TestRunner)

**Files:**
- Create: `backend/app/deps.py`

- [ ] **Step 1: Implement `app/deps.py`**

```python
from __future__ import annotations

from typing import Optional

from app.config import Settings
from app.hardware.manager import HardwareManager
from app.services.event_bus import EventBus
from app.services.waveform import WaveformService
from app.services.ws_hub import WsHub

_settings: Optional[Settings] = None
_manager: Optional[HardwareManager] = None
_event_bus: Optional[EventBus] = None
_ws_hub: Optional[WsHub] = None
_waveform: Optional[WaveformService] = None
_runner = None


def set_settings(s: Settings) -> None:
    global _settings
    _settings = s


def get_settings() -> Settings:
    if _settings is None:
        raise RuntimeError("Settings not initialized")
    return _settings


def set_manager(m: HardwareManager) -> None:
    global _manager
    _manager = m


def get_manager() -> HardwareManager:
    if _manager is None:
        raise RuntimeError("HardwareManager not initialized")
    return _manager


def set_event_bus(b: EventBus) -> None:
    global _event_bus
    _event_bus = b


def get_event_bus() -> EventBus:
    if _event_bus is None:
        raise RuntimeError("EventBus not initialized")
    return _event_bus


def set_ws_hub(h: WsHub) -> None:
    global _ws_hub
    _ws_hub = h


def get_ws_hub() -> WsHub:
    if _ws_hub is None:
        raise RuntimeError("WsHub not initialized")
    return _ws_hub


def set_waveform(w: WaveformService) -> None:
    global _waveform
    _waveform = w


def get_waveform() -> WaveformService:
    if _waveform is None:
        raise RuntimeError("WaveformService not initialized")
    return _waveform


def set_runner(r) -> None:
    global _runner
    _runner = r


def get_runner():
    if _runner is None:
        raise RuntimeError("TestRunner not initialized")
    return _runner
```

- [ ] **Step 2: Commit**

```
git add backend/app/deps.py
git commit -m "feat(deps): module-level singletons for hardware/bus/hub/runner"
```

---

### Task 17: TestRunner (drives state machine + hardware + persistence + events)

**Files:**
- Create: `backend/app/services/test_runner.py`
- Test: `backend/tests/integration/test_runner_e2e_mock.py`

- [ ] **Step 1: Implement `app/services/test_runner.py`**

```python
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import List, Optional

from loguru import logger
from sqlmodel import Session

from app.config import Settings
from app.db.engine import get_engine
from app.db.models import Recipe, TestLoop, TestRun
from app.hardware.base import PlcEvent, ImadaReading, Esp32Reading
from app.hardware.manager import HardwareManager
from app.services.event_bus import EventBus
from app.services.state_machine import Event as SmEvent, RunMode, State, StateMachine
from app.services.waveform import WaveformSample, WaveformService


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TestRunner:
    def __init__(
        self,
        settings: Settings,
        manager: HardwareManager,
        bus: EventBus,
        waveform: WaveformService,
    ):
        self.settings = settings
        self.manager = manager
        self.bus = bus
        self.waveform = waveform
        self._task: Optional[asyncio.Task] = None
        self._sm: Optional[StateMachine] = None
        self._run_id: Optional[int] = None
        self._recipe: Optional[Recipe] = None
        self._mode: Optional[RunMode] = None
        self._manual_clamp: asyncio.Event = asyncio.Event()
        self._abort: asyncio.Event = asyncio.Event()
        self._reset: asyncio.Event = asyncio.Event()
        self._b5_at: Optional[int] = None
        self._buffer: List[WaveformSample] = []
        self._loop_start_iso: Optional[str] = None

    # ----- public API -----
    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self, recipe: Recipe, operator: Optional[str], batch_id: Optional[str], shift: Optional[str], mode: RunMode) -> int:
        if self.is_running:
            raise RuntimeError("Runner already in session")
        self._recipe = recipe
        self._mode = mode
        self._abort.clear()
        self._reset.clear()
        self._manual_clamp.clear()

        with Session(get_engine()) as s:
            run = TestRun(
                recipe_id=recipe.id,
                operator=operator,
                batch_id=batch_id,
                shift=shift,
                started_at=_now_iso(),
                status="running",
                waveform_dir=f"{self.waveform.base_dir.name}/{{run_id}}",
            )
            s.add(run)
            s.commit()
            s.refresh(run)
            self._run_id = run.id

        self._sm = StateMachine(loop_count=recipe.loop_count, mode=mode)
        self._sm.add_listener(self._on_state_change)
        self._task = asyncio.create_task(self._run_loop())
        return self._run_id

    async def request_manual_clamp(self) -> None:
        self._manual_clamp.set()

    async def request_abort(self) -> None:
        self._abort.set()
        if self.manager.plc:
            self.manager.plc.set_bit(1, True)

    async def request_reset(self) -> None:
        self._reset.set()
        if self.manager.plc:
            self.manager.plc.set_bit(2, True)

    # ----- internals -----
    def _on_state_change(self, old: State, new: State, evt: SmEvent) -> None:
        asyncio.create_task(self.bus.publish({
            "type": "state_change",
            "run_id": self._run_id,
            "from": old.value,
            "to": new.value,
            "loop": (self._sm.current_loop if self._sm else None),
            "at": _now_iso(),
        }))

    async def _publish(self, msg: dict) -> None:
        await self.bus.publish(msg)

    async def _wait_for_bit(self, addr: int, timeout_ms: int) -> bool:
        deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
        while asyncio.get_running_loop().time() < deadline:
            if self._abort.is_set():
                return False
            try:
                evt: PlcEvent = await asyncio.wait_for(self.manager.plc_event_queue.get(), timeout=0.1)
            except asyncio.TimeoutError:
                continue
            await self._publish({"type": "plc_bit", "addr": evt.addr, "value": bool(evt.value)})
            if evt.kind == "bit" and evt.addr == addr and evt.value:
                return True
        return False

    async def _run_loop(self) -> None:
        sm = self._sm
        plc = self.manager.plc
        recipe = self._recipe
        assert sm and plc and recipe

        # Write params
        sm.dispatch(SmEvent.START)
        plc.write_word(100, int(recipe.position_mm * 100))
        plc.write_word(102, int(recipe.speed_mms * 100))
        plc.write_word(0, recipe.loop_count)
        plc.set_bit(0, True)  # B0 = start
        sm.dispatch(SmEvent.PARAMS_WRITTEN)

        timeouts = self.settings.hardware.state_timeouts

        while sm.state in (State.LOOP_BEGIN, State.CLAMP_PRESSED, State.WAIT_CLAMP_FORCE, State.WAIT_B5, State.TENSION_CHECK, State.EVALUATE, State.UNCLAMP):
            if self._abort.is_set():
                sm.dispatch(SmEvent.ABORT)
                break

            # LOOP_BEGIN -> CLAMP_PRESSED
            if sm.state == State.LOOP_BEGIN:
                if self._mode == RunMode.MANUAL:
                    self._manual_clamp.clear()
                    try:
                        await asyncio.wait_for(self._manual_clamp.wait(), timeout=timeouts.wait_b5_ms / 1000)
                    except asyncio.TimeoutError:
                        sm.dispatch(SmEvent.ERROR)
                        return
                    sm.dispatch(SmEvent.MANUAL_CLAMP_REQUESTED)
                else:
                    sm.dispatch(SmEvent.AUTO_TRIGGER_CLAMP)

            # CLAMP_PRESSED
            if sm.state == State.CLAMP_PRESSED:
                plc.set_bit(3, True)  # press clamp
                self.manager.start_esp32_stream()
                sm.dispatch(SmEvent.CLAMP_PRESSED_ACK)

            # WAIT_CLAMP_FORCE
            if sm.state == State.WAIT_CLAMP_FORCE:
                reached = await self._wait_for_clamp_force(recipe.clamp_threshold_n, timeouts.wait_clamp_force_ms)
                if not reached:
                    sm.dispatch(SmEvent.ERROR)
                    return
                plc.set_bit(4, True)  # stop clamp actuator
                self.manager.stop_esp32_stream()
                sm.dispatch(SmEvent.CLAMP_FORCE_REACHED)

            # WAIT_B5
            if sm.state == State.WAIT_B5:
                if not await self._wait_for_bit(5, timeouts.wait_b5_ms):
                    sm.dispatch(SmEvent.ERROR)
                    return
                sm.dispatch(SmEvent.B5_RECEIVED)

            # TENSION_CHECK
            if sm.state == State.TENSION_CHECK:
                self._b5_at = time.monotonic_ns()
                self._buffer = []
                self._loop_start_iso = _now_iso()
                self.manager.start_imada_stream()
                await self._collect_tension(timeouts.tension_check_ms)
                self.manager.stop_imada_stream()
                sm.dispatch(SmEvent.B6_RECEIVED)

            # EVALUATE
            if sm.state == State.EVALUATE:
                summary = self.waveform.summarize(self._buffer, recipe.min_force_n)
                waveform_path = self.waveform.write_loop(self._run_id, sm.current_loop, self._buffer)
                judgment = self._judge(summary, recipe)
                with Session(get_engine()) as s:
                    loop_row = TestLoop(
                        run_id=self._run_id,
                        loop_index=sm.current_loop,
                        started_at=self._loop_start_iso or _now_iso(),
                        finished_at=_now_iso(),
                        peak_force_n=summary.peak_force_n,
                        avg_force_n=summary.avg_force_n,
                        hold_time_ms=summary.hold_time_ms,
                        judgment=judgment,
                        waveform_file=waveform_path.name,
                    )
                    s.add(loop_row)
                    run = s.get(TestRun, self._run_id)
                    if run:
                        run.loops_completed = sm.current_loop
                    s.commit()
                await self._publish({
                    "type": "loop_result",
                    "run_id": self._run_id,
                    "loop": sm.current_loop,
                    "peak_force_n": summary.peak_force_n,
                    "avg_force_n": summary.avg_force_n,
                    "hold_time_ms": summary.hold_time_ms,
                    "judgment": judgment,
                })
                sm.dispatch(SmEvent.EVALUATION_DONE)

            # UNCLAMP
            if sm.state == State.UNCLAMP:
                plc.set_bit(3, False)
                plc.set_bit(4, False)
                # In real life, PLC bits B5/B6 reset themselves; mock resets after script ends.
                # Drain any residual events.
                while not self.manager.plc_event_queue.empty():
                    try:
                        self.manager.plc_event_queue.get_nowait()
                    except Exception:
                        break
                sm.dispatch(SmEvent.UNCLAMP_DONE)

        # DONE_B7 or terminal
        if sm.state == State.DONE_B7:
            if await self._wait_for_bit(7, self.settings.hardware.state_timeouts.done_b7_ms):
                sm.dispatch(SmEvent.B7_RECEIVED)
            else:
                sm.dispatch(SmEvent.ERROR)

        await self._finalize()

    async def _wait_for_clamp_force(self, threshold_n: float, timeout_ms: int) -> bool:
        deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
        batch: List[List[float]] = []
        while asyncio.get_running_loop().time() < deadline:
            if self._abort.is_set():
                return False
            try:
                r: Esp32Reading = await asyncio.wait_for(self.manager.esp32_queue.get(), timeout=0.05)
            except asyncio.TimeoutError:
                continue
            batch.append([0.0, r.force_n])
            if len(batch) >= 5:
                await self._publish({
                    "type": "esp32_batch",
                    "run_id": self._run_id,
                    "samples": batch,
                })
                batch = []
            if r.force_n >= threshold_n:
                if batch:
                    await self._publish({"type": "esp32_batch", "run_id": self._run_id, "samples": batch})
                return True
        return False

    async def _collect_tension(self, timeout_ms: int) -> None:
        # B6 arrives via plc_event_queue; we also have a time cap.
        deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
        batch: List[List[float]] = []
        last_emit = asyncio.get_running_loop().time()
        while asyncio.get_running_loop().time() < deadline:
            if self._abort.is_set():
                return
            # Check for B6 first (non-blocking)
            try:
                evt: PlcEvent = self.manager.plc_event_queue.get_nowait()
            except asyncio.QueueEmpty:
                evt = None
            if evt and evt.kind == "bit" and evt.addr == 6 and evt.value:
                if batch:
                    await self._publish({
                        "type": "imada_batch",
                        "run_id": self._run_id,
                        "loop": self._sm.current_loop,
                        "samples": batch,
                    })
                return
            # Drain imada
            try:
                r: ImadaReading = await asyncio.wait_for(self.manager.imada_queue.get(), timeout=0.02)
            except asyncio.TimeoutError:
                continue
            t_ms = int((r.timestamp_ns - self._b5_at) / 1_000_000)
            if t_ms < 0:
                t_ms = 0
            self._buffer.append(WaveformSample(t_ms=t_ms, force_n=r.force_n))
            batch.append([t_ms, r.force_n])
            now = asyncio.get_running_loop().time()
            if now - last_emit >= 0.05:
                await self._publish({
                    "type": "imada_batch",
                    "run_id": self._run_id,
                    "loop": self._sm.current_loop,
                    "samples": batch,
                })
                batch = []
                last_emit = now

    def _judge(self, summary, recipe: Recipe) -> str:
        ok = True
        if recipe.min_force_n is not None and summary.peak_force_n < recipe.min_force_n:
            ok = False
        if recipe.max_force_n is not None and summary.peak_force_n > recipe.max_force_n:
            ok = False
        if recipe.hold_time_ms is not None and summary.hold_time_ms < recipe.hold_time_ms:
            ok = False
        return "pass" if ok else "fail"

    async def _finalize(self) -> None:
        if self._run_id is None:
            return
        with Session(get_engine()) as s:
            run = s.get(TestRun, self._run_id)
            if run is None:
                return
            if self._sm and self._sm.state == State.IDLE:
                # Determine pass/fail from loop judgments
                rows = [r for r in s.exec(__import__("sqlmodel").select(TestLoop).where(TestLoop.run_id == self._run_id)).all()]
                run.status = "pass" if all(r.judgment == "pass" for r in rows) and rows else "fail"
            elif self._sm and self._sm.state == State.ABORTED:
                run.status = "aborted"
            elif self._sm and self._sm.state == State.ERROR:
                run.status = "error"
            run.finished_at = _now_iso()
            s.add(run)
            s.commit()
        await self._publish({
            "type": "run_finished",
            "run_id": self._run_id,
            "status": (self._sm.state.value if self._sm else "error"),
            "loops_completed": (self._sm.current_loop if self._sm else 0),
        })
        self._task = None
        self._run_id = None
```

> **Note (intentional for Plan 1):** the runner relies on the mock PLC's scripted timing — set_bit(3) triggers B5→B6→B7 emissions. Plan 3 replaces the mock with a real PLC; the runner contract stays the same.

- [ ] **Step 2: Write E2E test `tests/integration/test_runner_e2e_mock.py`**

```python
import asyncio

import pytest
from sqlmodel import SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from app.config import (
    Esp32Calibration,
    Esp32Config,
    HardwareConfig,
    ImadaConfig,
    PlcConfig,
    Settings,
    ServerConfig,
    StateTimeouts,
    StorageConfig,
)
from app.db import engine as db_engine
from app.db.models import Recipe, TestLoop, TestRun
from app.hardware.manager import HardwareManager
from app.services.event_bus import EventBus
from app.services.state_machine import RunMode
from app.services.test_runner import TestRunner
from app.services.waveform import WaveformService


def _settings(wf_dir) -> Settings:
    return Settings(
        hardware=HardwareConfig(
            plc=PlcConfig(),
            imada=ImadaConfig(),
            esp32=Esp32Config(calibration=Esp32Calibration(slope=0.01, offset=0.0)),
            state_timeouts=StateTimeouts(
                wait_clamp_force_ms=2000,
                wait_b5_ms=2000,
                tension_check_ms=2000,
                done_b7_ms=2000,
            ),
        ),
        storage=StorageConfig(db_url="sqlite://", waveforms_dir=str(wf_dir)),
        server=ServerConfig(),
        mock_mode=True,
    )


@pytest.mark.asyncio
async def test_full_session_two_loops_pass(tmp_path):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    db_engine._engine = e

    with __import__("sqlmodel").Session(e) as s:
        r = Recipe(
            name="e2e",
            position_mm=10.0,
            speed_mms=5.0,
            clamp_threshold_n=5.0,
            loop_count=2,
            min_force_n=1.0,
            max_force_n=10.0,
            hold_time_ms=100,
            sampling_hz=100,
            created_at="now",
            updated_at="now",
        )
        s.add(r)
        s.commit()
        s.refresh(r)
        recipe = r

    settings = _settings(tmp_path)
    manager = HardwareManager(settings)
    bus = EventBus()
    waveform = WaveformService(base_dir=tmp_path)
    await manager.start()
    runner = TestRunner(settings, manager, bus, waveform)

    run_id = await runner.start(recipe, operator="op", batch_id="b", shift="A", mode=RunMode.AUTO)
    # Wait until task completes (mock script completes in ~0.6s per loop × 2)
    for _ in range(60):
        if runner._task is None or runner._task.done():
            break
        await asyncio.sleep(0.1)
    if runner._task is not None and not runner._task.done():
        await runner._task

    await manager.shutdown()

    with __import__("sqlmodel").Session(e) as s:
        run = s.get(TestRun, run_id)
        assert run is not None
        assert run.status in ("pass", "fail")  # judgment depends on synthetic data
        assert run.loops_completed == 2
        loops = list(s.exec(select(TestLoop).where(TestLoop.run_id == run_id)).all())
        assert len(loops) == 2
```

- [ ] **Step 3: Run test, expect failure first (because of MockPlc B5/B6 must not auto-fire BEFORE clamp reached — current mock fires on B3). Adjust mock script timing if needed.**

```
pytest tests/integration/test_runner_e2e_mock.py -v
```

If it fails because of timing race (mock emits B5/B6 too early relative to ESP32 ramp), increase `MockPlcScript(after_b3_to_b5_ms=600)` so that B5 fires after the 500ms ESP32 ramp completes. Adjust in `HardwareManager.start()`:

```python
self.plc = MockPlc(script=MockPlcScript(after_b3_to_b5_ms=600, after_b5_to_b6_ms=600, after_b6_to_b7_ms=100))
```

- [ ] **Step 4: Re-run test, expect pass**

```
pytest tests/integration/test_runner_e2e_mock.py -v
```
Expected: PASS within ~5 seconds.

- [ ] **Step 5: Commit**

```
git add backend/app/services/test_runner.py backend/tests/integration/test_runner_e2e_mock.py backend/app/hardware/manager.py
git commit -m "feat(runner): full async test runner orchestrating mocks + persistence + events"
```

---

### Task 18: Sessions REST API

**Files:**
- Create: `backend/app/schemas/session.py`, `backend/app/api/sessions.py`
- Test: `backend/tests/integration/test_sessions_api.py`

- [ ] **Step 1: Implement `app/schemas/session.py`**

```python
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class SessionStartRequest(BaseModel):
    recipe_id: int
    operator: Optional[str] = None
    batch_id: Optional[str] = None
    shift: Optional[str] = None
    mode: Literal["manual", "auto"] = "auto"


class SessionStartResponse(BaseModel):
    run_id: int
```

- [ ] **Step 2: Implement `app/api/sessions.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app import deps
from app.db.engine import get_session
from app.schemas.session import SessionStartRequest, SessionStartResponse
from app.services.recipe_service import RecipeService
from app.services.state_machine import RunMode

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("/start", response_model=SessionStartResponse)
async def start_session(req: SessionStartRequest, session: Session = Depends(get_session)):
    runner = deps.get_runner()
    if runner.is_running:
        raise HTTPException(409, "Session already running")
    recipe = RecipeService(session).get(req.recipe_id)
    if recipe is None:
        raise HTTPException(404, "Recipe not found")
    run_id = await runner.start(
        recipe=recipe,
        operator=req.operator,
        batch_id=req.batch_id,
        shift=req.shift,
        mode=RunMode(req.mode),
    )
    return SessionStartResponse(run_id=run_id)


@router.post("/{run_id}/clamp")
async def clamp(run_id: int):
    runner = deps.get_runner()
    await runner.request_manual_clamp()
    return {"ok": True}


@router.post("/{run_id}/stop")
async def stop(run_id: int):
    runner = deps.get_runner()
    await runner.request_abort()
    return {"ok": True}


@router.post("/{run_id}/reset")
async def reset(run_id: int):
    runner = deps.get_runner()
    await runner.request_reset()
    return {"ok": True}
```

- [ ] **Step 3: Write integration test `tests/integration/test_sessions_api.py`**

```python
import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    monkeypatch.setenv("PINCH_TEST_WAVEFORM_DIR", str(tmp_path))
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    return TestClient(app)


def test_start_session_404_recipe(client):
    r = client.post("/api/sessions/start", json={"recipe_id": 999})
    assert r.status_code == 404


def test_start_and_stop_flow(client):
    payload = {
        "name": "s1",
        "position_mm": 10.0,
        "speed_mms": 5.0,
        "clamp_threshold_n": 5.0,
        "loop_count": 1,
        "min_force_n": 0.0,
        "max_force_n": 100.0,
        "hold_time_ms": 0,
    }
    rid = client.post("/api/recipes", json=payload).json()["id"]
    r = client.post("/api/sessions/start", json={"recipe_id": rid, "mode": "auto"})
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    # cannot start another session while one runs
    r2 = client.post("/api/sessions/start", json={"recipe_id": rid, "mode": "auto"})
    assert r2.status_code == 409
    # stop
    r3 = client.post(f"/api/sessions/{run_id}/stop")
    assert r3.status_code == 200
```

- [ ] **Step 4: Commit (impl + test)** — final state expected after Task 19 main.py wiring.

```
git add backend/app/schemas/session.py backend/app/api/sessions.py backend/tests/integration/test_sessions_api.py
git commit -m "feat(sessions): start/clamp/stop/reset endpoints driving TestRunner"
```

---

### Task 19: Wire main.py with full lifespan (settings, db, manager, bus, hub, runner)

**Files:**
- Modify: `backend/app/main.py`
- Test: rerun all integration tests after this task

- [ ] **Step 1: Replace `app/main.py` content**

```python
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI

from app import deps
from app.api import recipes, sessions, ws
from app.config import Settings, load_settings
from app.db.engine import init_engine
from app.hardware.manager import HardwareManager
from app.logging_setup import configure_logging
from app.services.event_bus import EventBus
from app.services.test_runner import TestRunner
from app.services.waveform import WaveformService
from app.services.ws_hub import WsHub


def _load_or_default(test_mode: bool, waveform_dir: Optional[Path]) -> Settings:
    if test_mode:
        from app.config import (
            Esp32Calibration,
            Esp32Config,
            HardwareConfig,
            ImadaConfig,
            PlcConfig,
            ServerConfig,
            StateTimeouts,
            StorageConfig,
        )
        return Settings(
            hardware=HardwareConfig(
                plc=PlcConfig(),
                imada=ImadaConfig(),
                esp32=Esp32Config(calibration=Esp32Calibration(slope=0.01, offset=0.0)),
                state_timeouts=StateTimeouts(
                    wait_clamp_force_ms=2000,
                    wait_b5_ms=2000,
                    tension_check_ms=2000,
                    done_b7_ms=2000,
                ),
            ),
            storage=StorageConfig(
                db_url="sqlite://",
                waveforms_dir=str(waveform_dir or Path("./waveforms")),
            ),
            server=ServerConfig(),
            mock_mode=True,
        )
    return load_settings(Path("config.yaml"))


def build_app(test_mode: bool = False, waveform_dir: Optional[Path] = None) -> FastAPI:
    settings = _load_or_default(test_mode, waveform_dir)
    deps.set_settings(settings)

    configure_logging(level="INFO", log_dir=Path("logs"))

    if not test_mode:
        init_engine(settings.storage.db_url)

    bus = EventBus()
    hub = WsHub(bus)
    waveform = WaveformService(base_dir=Path(settings.storage.waveforms_dir))
    manager = HardwareManager(settings)
    deps.set_event_bus(bus)
    deps.set_ws_hub(hub)
    deps.set_waveform(waveform)
    deps.set_manager(manager)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await manager.start()
        runner = TestRunner(settings, manager, bus, waveform)
        deps.set_runner(runner)
        pump_task = asyncio.create_task(hub.pump())
        try:
            yield
        finally:
            pump_task.cancel()
            await manager.shutdown()

    app = FastAPI(title="Pinch Test MC", lifespan=lifespan)
    app.include_router(recipes.router)
    app.include_router(sessions.router)
    app.include_router(ws.router)
    return app


app = build_app()
```

- [ ] **Step 2: Run all tests**

```
pytest -v
```
Expected: all green. If `test_start_and_stop_flow` fails due to lifespan not firing under TestClient, wrap with `with TestClient(app) as client:` — fix fixture by adding `with TestClient(app) as c: yield c` in `tests/integration/test_sessions_api.py`.

- [ ] **Step 3: Patch fixture if needed**

In `tests/integration/test_sessions_api.py`, change fixture to:

```python
@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        yield c
```

- [ ] **Step 4: Re-run tests**

```
pytest -v
```
Expected: all green.

- [ ] **Step 5: Commit**

```
git add backend/app/main.py backend/tests/integration/test_sessions_api.py
git commit -m "feat(main): lifespan wires manager, bus, hub, runner; tests use lifespan-aware client"
```

---

### Task 20: Runs REST API (list, detail, waveform JSON, CSV export)

**Files:**
- Create: `backend/app/schemas/run.py`, `backend/app/api/runs.py`
- Test: `backend/tests/integration/test_runs_api.py`

- [ ] **Step 1: Implement `app/schemas/run.py`**

```python
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class TestLoopRead(BaseModel):
    id: int
    loop_index: int
    started_at: str
    finished_at: Optional[str] = None
    peak_force_n: Optional[float] = None
    avg_force_n: Optional[float] = None
    hold_time_ms: Optional[int] = None
    judgment: Optional[str] = None
    waveform_file: Optional[str] = None

    model_config = {"from_attributes": True}


class TestRunRead(BaseModel):
    id: int
    recipe_id: int
    operator: Optional[str] = None
    batch_id: Optional[str] = None
    shift: Optional[str] = None
    started_at: str
    finished_at: Optional[str] = None
    status: str
    abort_reason: Optional[str] = None
    loops_completed: int
    waveform_dir: Optional[str] = None
    loops: List[TestLoopRead] = []

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Implement `app/api/runs.py`**

```python
from __future__ import annotations

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app import deps
from app.db.engine import get_session
from app.db.models import TestLoop, TestRun
from app.schemas.run import TestRunRead

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.get("", response_model=list[TestRunRead])
def list_runs(
    session: Session = Depends(get_session),
    status: Optional[str] = None,
    recipe_id: Optional[int] = None,
    operator: Optional[str] = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
):
    stmt = select(TestRun).order_by(TestRun.started_at.desc())
    if status:
        stmt = stmt.where(TestRun.status == status)
    if recipe_id:
        stmt = stmt.where(TestRun.recipe_id == recipe_id)
    if operator:
        stmt = stmt.where(TestRun.operator == operator)
    stmt = stmt.offset(offset).limit(limit)
    runs = list(session.exec(stmt).all())
    return [
        TestRunRead.model_validate({**r.model_dump(), "loops": []})
        for r in runs
    ]


@router.get("/{run_id}", response_model=TestRunRead)
def get_run(run_id: int, session: Session = Depends(get_session)):
    run = session.get(TestRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    loops = list(session.exec(select(TestLoop).where(TestLoop.run_id == run_id).order_by(TestLoop.loop_index)).all())
    return TestRunRead.model_validate({**run.model_dump(), "loops": [TestLoop.model_dump(l) if hasattr(TestLoop, "model_dump") else l.dict() for l in loops]})


@router.get("/{run_id}/loops/{idx}/waveform")
def get_waveform(run_id: int, idx: int):
    wf = deps.get_waveform()
    try:
        return wf.read_loop(run_id, idx)
    except FileNotFoundError:
        raise HTTPException(404, "Waveform not found")


@router.get("/{run_id}/export.csv")
def export_csv(run_id: int, session: Session = Depends(get_session)):
    run = session.get(TestRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    loops = list(session.exec(select(TestLoop).where(TestLoop.run_id == run_id).order_by(TestLoop.loop_index)).all())
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["run_id", "loop_index", "started_at", "finished_at", "peak_force_n", "avg_force_n", "hold_time_ms", "judgment"])
    for l in loops:
        writer.writerow([run.id, l.loop_index, l.started_at, l.finished_at or "", l.peak_force_n or "", l.avg_force_n or "", l.hold_time_ms or "", l.judgment or ""])
    buffer.seek(0)
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="run_{run_id}.csv"'})
```

- [ ] **Step 3: Wire router in `main.py`**

In `build_app`, add:
```python
from app.api import runs
...
app.include_router(runs.router)
```

- [ ] **Step 4: Write integration test `tests/integration/test_runs_api.py`**

```python
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.db.models import Recipe, TestLoop, TestRun
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        # seed
        with Session(e) as s:
            r = Recipe(name="r", position_mm=1, speed_mms=1, clamp_threshold_n=1, loop_count=1,
                       created_at="t", updated_at="t")
            s.add(r); s.commit(); s.refresh(r)
            run = TestRun(recipe_id=r.id, started_at="t", status="pass", loops_completed=1)
            s.add(run); s.commit(); s.refresh(run)
            loop = TestLoop(run_id=run.id, loop_index=1, started_at="t", peak_force_n=8.0, judgment="pass")
            s.add(loop); s.commit()
        yield c


def test_list_and_get_run(client):
    r = client.get("/api/runs")
    assert r.status_code == 200
    runs = r.json()
    assert len(runs) == 1
    rid = runs[0]["id"]

    r = client.get(f"/api/runs/{rid}")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pass"


def test_export_csv(client):
    rid = client.get("/api/runs").json()[0]["id"]
    r = client.get(f"/api/runs/{rid}/export.csv")
    assert r.status_code == 200
    assert "loop_index" in r.text
```

- [ ] **Step 5: Run tests**

```
pytest tests/integration/test_runs_api.py -v
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add backend/app/schemas/run.py backend/app/api/runs.py backend/app/main.py backend/tests/integration/test_runs_api.py
git commit -m "feat(runs): list/get/waveform/CSV endpoints"
```

---

### Task 21: Hardware status + config + reconnect endpoints

**Files:**
- Create: `backend/app/schemas/hardware.py`, `backend/app/api/hardware.py`, `backend/app/api/config.py`
- Test: `backend/tests/integration/test_hardware_api.py`

- [ ] **Step 1: Implement `app/schemas/hardware.py`**

```python
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class HardwareStatus(BaseModel):
    plc: bool
    imada: bool
    esp32: bool


class ReconnectRequest(BaseModel):
    device: Literal["plc", "imada", "esp32"]


class CalibrateRequest(BaseModel):
    raw_at_zero: int
    raw_at_known: int
    known_force_n: float
```

- [ ] **Step 2: Implement `app/api/hardware.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import deps
from app.schemas.hardware import CalibrateRequest, HardwareStatus, ReconnectRequest

router = APIRouter(prefix="/api/hardware", tags=["hardware"])


@router.get("/status", response_model=HardwareStatus)
def status() -> HardwareStatus:
    mgr = deps.get_manager()
    return HardwareStatus(
        plc=bool(mgr.plc and mgr.plc.is_connected),
        imada=bool(mgr.imada and mgr.imada.is_connected),
        esp32=bool(mgr.esp32 and mgr.esp32.is_connected),
    )


@router.post("/reconnect")
def reconnect(req: ReconnectRequest):
    mgr = deps.get_manager()
    dev = getattr(mgr, req.device, None)
    if dev is None:
        raise HTTPException(400, "Unknown device")
    dev.disconnect()
    dev.connect()
    return {"ok": True}


@router.post("/esp32/calibrate")
def calibrate(req: CalibrateRequest):
    if req.raw_at_zero == req.raw_at_known:
        raise HTTPException(400, "raw_at_zero and raw_at_known must differ")
    slope = req.known_force_n / (req.raw_at_known - req.raw_at_zero)
    offset = -req.raw_at_zero * slope
    return {"slope": slope, "offset": offset}
```

- [ ] **Step 3: Implement `app/api/config.py`**

```python
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import deps

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
def read_config():
    settings = deps.get_settings()
    return settings.model_dump()


@router.put("")
def update_config(body: dict):
    runner = deps.get_runner()
    if runner.is_running:
        raise HTTPException(409, "Cannot update config while a session is running")
    # Plan 1: validate only — actual file write deferred to Task that adds file persistence.
    from app.config import Settings
    Settings.model_validate(body)
    return {"ok": True, "note": "validation-only in Plan 1"}
```

- [ ] **Step 4: Wire routers in `main.py`**

In `build_app`, add:
```python
from app.api import config as config_api, hardware as hardware_api
...
app.include_router(hardware_api.router)
app.include_router(config_api.router)
```

- [ ] **Step 5: Integration test `tests/integration/test_hardware_api.py`**

```python
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        yield c


def test_hardware_status(client):
    r = client.get("/api/hardware/status")
    assert r.status_code == 200
    body = r.json()
    assert body["plc"] is True
    assert body["imada"] is True
    assert body["esp32"] is True


def test_esp32_calibration_compute(client):
    r = client.post("/api/hardware/esp32/calibrate", json={
        "raw_at_zero": 0,
        "raw_at_known": 1000,
        "known_force_n": 10.0,
    })
    assert r.status_code == 200
    body = r.json()
    assert abs(body["slope"] - 0.01) < 1e-9
    assert abs(body["offset"]) < 1e-9


def test_config_get(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    assert "hardware" in r.json()
```

- [ ] **Step 6: Run tests**

```
pytest tests/integration/test_hardware_api.py -v
```
Expected: PASS.

- [ ] **Step 7: Commit**

```
git add backend/app/schemas/hardware.py backend/app/api/hardware.py backend/app/api/config.py backend/app/main.py backend/tests/integration/test_hardware_api.py
git commit -m "feat(hardware,config): status/reconnect/calibrate + config endpoints"
```

---

### Task 22: WebSocket integration test (full session via WS)

**Files:**
- Test: `backend/tests/integration/test_ws.py`

- [ ] **Step 1: Write test `tests/integration/test_ws.py`**

```python
import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.db.models import Recipe
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        with Session(e) as s:
            r = Recipe(
                name="ws", position_mm=10, speed_mms=5, clamp_threshold_n=5, loop_count=1,
                min_force_n=0, max_force_n=100, hold_time_ms=0, sampling_hz=100,
                created_at="t", updated_at="t",
            )
            s.add(r); s.commit(); s.refresh(r)
        yield c


def test_ws_emits_state_changes_and_finished(client):
    with client.websocket_connect("/ws") as ws:
        # Start a session
        rid = client.get("/api/recipes").json()[0]["id"]
        run_resp = client.post("/api/sessions/start", json={"recipe_id": rid, "mode": "auto"})
        assert run_resp.status_code == 200, run_resp.text
        # Collect a handful of messages with timeout
        seen_types = set()
        for _ in range(200):
            try:
                msg = ws.receive_json(timeout=0.05)
            except Exception:
                continue
            seen_types.add(msg.get("type"))
            if "run_finished" in seen_types:
                break
        assert "state_change" in seen_types
        assert "run_finished" in seen_types
```

- [ ] **Step 2: Run test**

```
pytest tests/integration/test_ws.py -v
```
Expected: PASS. If WS connection blocks before lifespan starts, ensure `with TestClient(app) as c:` is used (Starlette starts the lifespan once the context enters).

- [ ] **Step 3: Commit**

```
git add backend/tests/integration/test_ws.py
git commit -m "test(ws): full session emits state_change + run_finished over WebSocket"
```

---

### Task 23: Full test sweep + bring-up docs

**Files:**
- Modify: `README.md`
- Run: full test suite

- [ ] **Step 1: Update `README.md`** with development quickstart

```markdown
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
- [Plan 1 — Backend Foundation + Mock E2E](docs/superpowers/plans/2026-05-19-plan-1-backend-mock-e2e.md) ← this plan
- Plan 2 — Frontend (Vite + ShadcnUI)
- Plan 3 — Real hardware drivers
- Plan 4 — History + Hardware + Settings + Calibration UI
```

- [ ] **Step 2: Run all tests**

```
cd backend
pytest -v
```
Expected: all unit and integration tests PASS. Acceptance bar: state-machine + E2E + WS + recipes/runs/hardware/config all green.

- [ ] **Step 3: Smoke-run the server**

```
cd backend
uvicorn app.main:app --port 8000
```

In another shell:
```
curl http://localhost:8000/api/hardware/status
```
Expected: JSON `{"plc": true, "imada": true, "esp32": true}`.

```
curl -X POST http://localhost:8000/api/recipes -H "Content-Type: application/json" -d "{\"name\":\"smoke\",\"position_mm\":10,\"speed_mms\":5,\"clamp_threshold_n\":5,\"loop_count\":1}"
curl -X POST http://localhost:8000/api/sessions/start -H "Content-Type: application/json" -d "{\"recipe_id\":1,\"mode\":\"auto\"}"
```
Expected: run completes (visible in logs); `GET /api/runs` shows the row.

- [ ] **Step 4: Commit**

```
git add README.md
git commit -m "docs: README with mock-mode quickstart and plan index"
```

---

## Acceptance Criteria for Plan 1

- `pytest -v` returns 0 with all listed unit + integration tests passing.
- `uvicorn app.main:app` starts without error with `mock_mode: true`.
- A POST to `/api/sessions/start` runs a full session end-to-end against the mocks and a corresponding `test_runs` row plus per-loop `test_loops` rows + parquet files exist under `data/waveforms/<run_id>/`.
- WebSocket clients receive `state_change`, `imada_batch`, `esp32_batch`, `loop_result`, and `run_finished` messages.
- E-Stop via `/api/sessions/{id}/stop` aborts an in-progress session within 200 ms.

## Out of Scope (deferred to later plans)

- Real serial drivers (Plan 3)
- Frontend UI (Plan 2)
- Config file persistence on PUT `/api/config` (Plan 4)
- History UI, hardware page UI, calibration wizard (Plan 4)
- ESP32 firmware (assumed external)
- **PLC heartbeat (W10)** and **polling B5/B6/B7 over serial** — the mock PLC emits edge events directly; the real KV-Link driver in Plan 3 will add the heartbeat writer thread and the 20 ms multi-bit poll loop. The `HardwareManager` interface and `plc_event_queue` contract used here are forward-compatible with that change (the runner observes events from the queue; it doesn't care whether they come from a mock callback or a polling thread).
