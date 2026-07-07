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


class PlcWordsRequest(BaseModel):
    words: dict[int, int]  # abstract word addr -> integer value
