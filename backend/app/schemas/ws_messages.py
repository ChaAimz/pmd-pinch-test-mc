from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class WsImadaBatch(BaseModel):
    type: Literal["imada_batch"] = "imada_batch"
    samples: List[List[float]]  # [[t_ms, force_n], ...]


class WsEsp32Batch(BaseModel):
    type: Literal["esp32_batch"] = "esp32_batch"
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
    min_force_n: float
    avg_force_n: float
    hold_time_ms: int
    tension_end_ms: Optional[int] = None
    peak_clamp_n: Optional[float] = None
    avg_clamp_n: Optional[float] = None
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
