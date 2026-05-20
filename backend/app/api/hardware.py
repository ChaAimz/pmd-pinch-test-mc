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
