from __future__ import annotations

from pathlib import Path
from typing import List

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PlcConfig(BaseModel):
    enabled: bool = True
    port: str = "COM3"
    baud: int = 38400
    poll_bits: List[int] = Field(default_factory=lambda: [5, 6, 7])
    poll_interval_ms: int = 20
    heartbeat_word: int = 10
    heartbeat_interval_ms: int = 200


class ImadaConfig(BaseModel):
    enabled: bool = True
    port: str = "COM5"
    baud: int = 19200
    decimal_format: bool = True


class Esp32Calibration(BaseModel):
    slope: float
    offset: float


class Esp32Config(BaseModel):
    enabled: bool = True
    port: str = "COM7"
    baud: int = 115200
    calibration: Esp32Calibration


class StateTimeouts(BaseModel):
    wait_clamp_force_ms: int = 10000
    wait_b5_ms: int = 30000
    tension_check_ms: int = 30000
    done_b7_ms: int = 30000


class HardwareConfig(BaseModel):
    plc: PlcConfig
    imada: ImadaConfig
    esp32: Esp32Config
    state_timeouts: StateTimeouts = Field(default_factory=StateTimeouts)


class StorageConfig(BaseModel):
    db_url: str = "sqlite:///./pinch.db"
    waveforms_dir: str = "./waveforms"


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8000


class Settings(BaseSettings):
    hardware: HardwareConfig
    storage: StorageConfig
    server: ServerConfig
    mock_mode: bool = True

    model_config = SettingsConfigDict(env_prefix="PINCH_", env_nested_delimiter="__")


def load_settings(path: Path | str) -> Settings:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    return Settings.model_validate(raw)
