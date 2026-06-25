from __future__ import annotations

import yaml
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
    new_settings = Settings.model_validate(body)
    config_path = deps.get_config_path()
    if config_path is None:
        raise HTTPException(500, "Config file path not configured; settings not persisted")
    config_path.write_text(
        yaml.dump(new_settings.model_dump(), default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )
    deps.set_settings(new_settings)
    return {"ok": True}
