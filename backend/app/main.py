from __future__ import annotations

import asyncio
import os
import signal
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI

from app import deps
from app.api import comparisons, config as config_api, hardware as hardware_api, recipes, runs, sessions, ws
from app.api import settings as settings_api
from app.api import system as system_api
from app.config import Settings, load_settings
from app.db.engine import init_engine
from app.hardware.manager import HardwareManager
from app.logging_setup import configure_logging
from app.services.event_bus import EventBus
from app.services.test_runner import TestRunner
from app.services.waveform import WaveformService
from app.services.ws_hub import WsHub


def _load_or_default(test_mode: bool, waveform_dir: Optional[Path]) -> Settings:
    if test_mode:
        from app.config import (
            Esp32Calibration,
            Esp32Config,
            HardwareConfig,
            ImadaConfig,
            PlcConfig,
            ServerConfig,
            StateTimeouts,
            StorageConfig,
        )
        return Settings(
            hardware=HardwareConfig(
                plc=PlcConfig(),
                imada=ImadaConfig(),
                esp32=Esp32Config(calibration=Esp32Calibration(slope=0.01, offset=0.0)),
                state_timeouts=StateTimeouts(
                    wait_clamp_force_ms=2000,
                    wait_b5_ms=2000,
                    tension_check_ms=2000,
                    done_b7_ms=2000,
                ),
            ),
            storage=StorageConfig(
                db_url="sqlite://",
                waveforms_dir=str(waveform_dir or Path("./waveforms")),
            ),
            server=ServerConfig(),
            mock_mode=True,
        )
    return load_settings(Path("config.yaml"))


def build_app(test_mode: bool = False, waveform_dir: Optional[Path] = None) -> FastAPI:
    settings = _load_or_default(test_mode, waveform_dir)
    deps.set_settings(settings)
    if not test_mode:
        deps.set_config_path(Path("config.yaml").resolve())

    configure_logging(level="INFO", log_dir=Path("logs"))

    if not test_mode:
        init_engine(settings.storage.db_url)

    bus = EventBus()
    hub = WsHub(bus)
    waveform = WaveformService(base_dir=Path(settings.storage.waveforms_dir))
    manager = HardwareManager(settings)
    deps.set_event_bus(bus)
    deps.set_ws_hub(hub)
    deps.set_waveform(waveform)
    deps.set_manager(manager)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await manager.start()
        runner = TestRunner(settings, manager, bus, waveform)
        deps.set_runner(runner)
        pump_task = asyncio.create_task(hub.pump())
        try:
            yield
        finally:
            pump_task.cancel()
            await manager.shutdown()

    app = FastAPI(title="Pinch Test MC", lifespan=lifespan)
    app.include_router(recipes.router)
    app.include_router(comparisons.router)
    app.include_router(sessions.router)
    app.include_router(runs.router)
    app.include_router(hardware_api.router)
    app.include_router(config_api.router)
    app.include_router(settings_api.router)
    app.include_router(system_api.router)
    app.include_router(ws.router)

    from fastapi import APIRouter as _AR
    _sys_router = _AR(prefix="/api/system", tags=["system"])

    @_sys_router.post("/shutdown")
    async def shutdown():
        """Shut down the Windows PC, then kill this process."""
        import subprocess, time
        def _shutdown():
            time.sleep(0.3)
            subprocess.Popen(["shutdown", "/s", "/f", "/t", "0"])
            time.sleep(0.5)
            os._exit(0)
        threading.Thread(target=_shutdown, daemon=True).start()
        return {"ok": True}

    app.include_router(_sys_router)
    return app


if Path("config.yaml").exists():
    app = build_app()
