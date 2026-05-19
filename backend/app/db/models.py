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
