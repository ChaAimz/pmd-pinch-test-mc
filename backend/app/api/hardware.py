from __future__ import annotations

import asyncio
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException
from loguru import logger

from app import deps
from app.schemas.hardware import (
    Esp32ClampOffsetRequest,
    Esp32ForceLimitRequest,
    HardwareStatus,
    PlcBitRequest,
    PlcWordsRequest,
    ReconnectRequest,
)

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
    # Imada and ESP32 need their poll/stream thread restarted after reconnect.
    # PLC manages its own event-poll thread internally inside connect().
    if req.device in ("imada", "esp32") and dev.is_connected:
        dev.start_stream()
    return {"ok": True}


@router.post("/imada/tare")
def imada_tare():
    """Send tare command ('Z\\r') to the Imada ZT-series force gauge."""
    mgr = deps.get_manager()
    if mgr.imada is None:
        raise HTTPException(503, "Imada not initialised")
    if not mgr.imada.is_connected:
        raise HTTPException(503, "Imada not connected")
    mgr.imada.tare()
    return {"ok": True}


@router.post("/esp32/tare")
def esp32_tare():
    """Send tare command ('t') to the ESP32 clamp-force sensor."""
    mgr = deps.get_manager()
    if mgr.esp32 is None:
        raise HTTPException(503, "ESP32 not initialised")
    if not mgr.esp32.is_connected:
        raise HTTPException(503, "ESP32 not connected")
    mgr.esp32.tare()
    return {"ok": True}


@router.get("/esp32/force-limit")
def get_esp32_force_limit():
    """Return the current ESP32 force limit and whether it's currently active."""
    mgr = deps.get_manager()
    return {
        "limit_gf": mgr.get_esp32_force_limit(),
        "active": mgr.is_esp32_limit_active(),
        "config_limit_gf": mgr.get_esp32_force_limit_config(),
    }


@router.post("/esp32/force-limit")
def set_esp32_force_limit(req: Esp32ForceLimitRequest):
    """Set or clear the ESP32 force limit. When force_n >= limit_gf, MR810 is set HIGH."""
    runner = deps.get_runner()
    if runner.is_running:
        raise HTTPException(409, "Cannot update config while a session is running")
    mgr = deps.get_manager()
    mgr.set_esp32_force_limit(req.limit_gf)
    _persist_force_limit_gf(req.limit_gf)
    return {"ok": True, "limit_gf": req.limit_gf}


def _persist_esp32_field(field: str, value) -> None:
    """Update a single hardware.esp32.<field> in config.yaml and in-memory settings."""
    config_path = deps.get_config_path()
    if config_path is None or not config_path.exists():
        return
    try:
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        raw.setdefault("hardware", {}).setdefault("esp32", {})[field] = value
        config_path.write_text(
            yaml.dump(raw, default_flow_style=False, allow_unicode=True),
            encoding="utf-8",
        )
        settings = deps.get_settings()
        new_esp32 = settings.hardware.esp32.model_copy(update={field: value})
        new_hw = settings.hardware.model_copy(update={"esp32": new_esp32})
        deps.set_settings(settings.model_copy(update={"hardware": new_hw}))
    except Exception:
        logger.exception("Failed to persist hardware.esp32.%s to config.yaml", field)


def _persist_force_limit_gf(limit_gf: Optional[float]) -> None:
    _persist_esp32_field("force_limit_gf", limit_gf)


def _persist_clamp_offset_gf(offset_gf: float) -> None:
    _persist_esp32_field("clamp_offset_gf", offset_gf)


@router.get("/esp32/clamp-offset")
def get_clamp_offset():
    """Return the current software clamp offset applied to the recipe clamp threshold."""
    mgr = deps.get_manager()
    return {"offset_gf": mgr.get_esp32_clamp_offset()}


@router.post("/esp32/clamp-offset")
def set_clamp_offset(req: Esp32ClampOffsetRequest):
    """Set the clamp offset (gf). effective_threshold = recipe_clamp_threshold + offset_gf."""
    runner = deps.get_runner()
    if runner.is_running:
        raise HTTPException(409, "Cannot update config while a session is running")
    mgr = deps.get_manager()
    mgr.set_esp32_clamp_offset(req.offset_gf)
    _persist_clamp_offset_gf(req.offset_gf)
    return {"ok": True, "offset_gf": req.offset_gf}


@router.post("/plc/words")
def set_plc_words(req: PlcWordsRequest):
    """Write multiple PLC word registers at once (W0/W100/W102 before start).

    Word address map per config.yaml device_map.words:
      W0  → DM28  (loop count)
      W100 → DM30  (actuator position mm × 100)
      W102 → DM32  (actuator speed mm/s × 100)
    """
    mgr = deps.get_manager()
    if mgr.plc is None:
        raise HTTPException(503, "PLC not initialised")
    if not mgr.plc.is_connected:
        raise HTTPException(503, "PLC not connected")

    for addr, value in req.words.items():
        mgr.plc.write_word(int(addr), int(value))

    return {"ok": True}


@router.post("/plc/bit")
async def set_plc_bit(req: PlcBitRequest):
    """Write a single Web→PLC bit (addr 0-4).

    Spec §2.1 — B5/B6/B7 are PLC→Web and must never be driven from here.
    If *pulse_ms* is given, the bit is written then inverted after that delay.
    """
    mgr = deps.get_manager()
    if mgr.plc is None:
        raise HTTPException(503, "PLC not initialised")
    if not mgr.plc.is_connected:
        raise HTTPException(503, "PLC not connected")

    mgr.plc.set_bit(req.addr, req.value)

    if req.pulse_ms is not None:
        await asyncio.sleep(req.pulse_ms / 1000)
        mgr.plc.set_bit(req.addr, not req.value)

    return {"ok": True, "addr": req.addr, "value": req.value}
