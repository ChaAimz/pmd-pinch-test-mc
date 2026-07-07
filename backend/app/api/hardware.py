from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import deps
from app.schemas.hardware import CalibrateRequest, HardwareStatus, PlcWordsRequest, ReconnectRequest

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


@router.post("/plc/words")
def set_plc_words(req: PlcWordsRequest):
    """Write multiple PLC word registers at once.

    Word address map (matches config.yaml device_map.words):
      0   → DM0   (loop count)
      100 → DM100 (actuator position mm × 100)
      102 → DM102 (actuator speed mm/s × 100)

    Values are 16-bit unsigned integers (0–65535).
    """
    mgr = deps.get_manager()
    if mgr.plc is None:
        raise HTTPException(503, "PLC not initialised")
    if not mgr.plc.is_connected:
        raise HTTPException(503, "PLC not connected")

    for addr, value in req.words.items():
        mgr.plc.write_word(int(addr), int(value))

    return {"ok": True}


@router.post("/esp32/calibrate")
def calibrate(req: CalibrateRequest):
    if req.raw_at_zero == req.raw_at_known:
        raise HTTPException(400, "raw_at_zero and raw_at_known must differ")
    slope = req.known_force_n / (req.raw_at_known - req.raw_at_zero)
    offset = -req.raw_at_zero * slope
    return {"slope": slope, "offset": offset}
