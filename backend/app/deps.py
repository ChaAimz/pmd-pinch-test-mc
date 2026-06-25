from __future__ import annotations

from pathlib import Path
from typing import Optional

from app.config import Settings
from app.hardware.manager import HardwareManager
from app.services.event_bus import EventBus
from app.services.waveform import WaveformService
from app.services.ws_hub import WsHub

_settings: Optional[Settings] = None
_config_path: Optional[Path] = None
_manager: Optional[HardwareManager] = None
_event_bus: Optional[EventBus] = None
_ws_hub: Optional[WsHub] = None
_waveform: Optional[WaveformService] = None
_runner = None


def set_settings(s: Settings) -> None:
    global _settings
    _settings = s


def get_settings() -> Settings:
    if _settings is None:
        raise RuntimeError("Settings not initialized")
    return _settings


def set_config_path(p: Path) -> None:
    global _config_path
    _config_path = p


def get_config_path() -> Optional[Path]:
    return _config_path


def set_manager(m: HardwareManager) -> None:
    global _manager
    _manager = m


def get_manager() -> HardwareManager:
    if _manager is None:
        raise RuntimeError("HardwareManager not initialized")
    return _manager


def set_event_bus(b: EventBus) -> None:
    global _event_bus
    _event_bus = b


def get_event_bus() -> EventBus:
    if _event_bus is None:
        raise RuntimeError("EventBus not initialized")
    return _event_bus


def set_ws_hub(h: WsHub) -> None:
    global _ws_hub
    _ws_hub = h


def get_ws_hub() -> WsHub:
    if _ws_hub is None:
        raise RuntimeError("WsHub not initialized")
    return _ws_hub


def set_waveform(w: WaveformService) -> None:
    global _waveform
    _waveform = w


def get_waveform() -> WaveformService:
    if _waveform is None:
        raise RuntimeError("WaveformService not initialized")
    return _waveform


def set_runner(r) -> None:
    global _runner
    _runner = r


def get_runner():
    if _runner is None:
        raise RuntimeError("TestRunner not initialized")
    return _runner
