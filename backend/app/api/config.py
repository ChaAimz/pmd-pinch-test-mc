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
    from app.config import Settings
    Settings.model_validate(body)
    return {"ok": True, "note": "validation-only in Plan 1"}
