from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class TestLoopRead(BaseModel):
    id: int
    loop_index: int
    started_at: str
    finished_at: Optional[str] = None
    peak_force_n: Optional[float] = None
    min_force_n: Optional[float] = None
    avg_force_n: Optional[float] = None
    hold_time_ms: Optional[int] = None
    tension_end_ms: Optional[int] = None
    peak_clamp_n: Optional[float] = None
    avg_clamp_n: Optional[float] = None
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
