from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class HardwareStatus(BaseModel):
    plc: bool
    imada: bool
    esp32: bool


class ReconnectRequest(BaseModel):
    device: Literal["plc", "imada", "esp32"]


# Web→PLC writable MR addresses only (PLC→Web bits must never be driven from here)
# MR808 = Tare ESP32 (pulses HIGH → backend forwards 't' to ESP32 over RS232)
_WEB_TO_PLC_MR = {800, 801, 802, 803, 804, 808, 101, 201, 502}


class PlcBitRequest(BaseModel):
    addr: int = Field(
        ...,
        description="Web→PLC MR address (MR800–MR804, MR808, MR101, MR201, MR502)",
    )
    value: bool
    pulse_ms: Optional[int] = Field(None, ge=1, description="If set, write value then invert after this many ms")

    def model_post_init(self, __context) -> None:
        if self.addr not in _WEB_TO_PLC_MR:
            raise ValueError(
                f"MR{self.addr} is not a writable Web→PLC bit. "
                f"Writable: {sorted(_WEB_TO_PLC_MR)}"
            )


class PlcWordsRequest(BaseModel):
    """Write multiple PLC word registers in one call.

    Keys are abstract word addresses (0, 100, 102, …); values are 16-bit ints.
    """
    words: dict[int, int]


class Esp32ForceLimitRequest(BaseModel):
    limit_gf: Optional[float] = Field(None, ge=0.0, description="Force limit in gf; null to disable")


class Esp32ClampOffsetRequest(BaseModel):
    offset_gf: float = 0.0
