from __future__ import annotations

from typing import Optional

from sqlmodel import Field, SQLModel


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
    sampling_hz: int = 50
    diameter_mm: float = 0.0
    prepare_timer_s: int = 0
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
    min_force_n: Optional[float] = None
    avg_force_n: Optional[float] = None
    hold_time_ms: Optional[int] = None
    tension_end_ms: Optional[int] = None  # ms from B5 when B6 (end tension check) fired
    peak_clamp_n: Optional[float] = None  # ESP32 force (N) at the moment MR804 was fired
    avg_clamp_n: Optional[float] = None   # mean ESP32 clamp force (N) during B5→B6 window
    judgment: Optional[str] = None
    waveform_file: Optional[str] = None


class AppSettings(SQLModel, table=True):
    __tablename__ = "app_settings"

    id: Optional[int] = Field(default=1, primary_key=True)
    data: str = "{}"  # JSON-encoded UI settings blob (camelCase keys, opaque to backend)


class Comparison(SQLModel, table=True):
    __tablename__ = "comparisons"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = None
    data: str = "{}"  # JSON blob: {"run_ids": [...], "labels": {...}, "annotations": [...]}
    created_at: str
    updated_at: str
