import asyncio

import pytest

from app.config import (
    Esp32Calibration,
    Esp32Config,
    HardwareConfig,
    ImadaConfig,
    PlcConfig,
    Settings,
    ServerConfig,
    StateTimeouts,
    StorageConfig,
)
from app.hardware.manager import HardwareManager


def _settings(tmp_path) -> Settings:
    return Settings(
        hardware=HardwareConfig(
            plc=PlcConfig(),
            imada=ImadaConfig(),
            esp32=Esp32Config(calibration=Esp32Calibration(slope=0.01, offset=0.0)),
            state_timeouts=StateTimeouts(),
        ),
        storage=StorageConfig(db_url="sqlite:///./test.db", waveforms_dir=str(tmp_path)),
        server=ServerConfig(),
        mock_mode=True,
    )


@pytest.mark.asyncio
async def test_manager_starts_mocks_and_streams(tmp_path):
    mgr = HardwareManager(_settings(tmp_path))
    await mgr.start()
    try:
        mgr.start_imada_stream()
        mgr.start_esp32_stream()
        await asyncio.sleep(0.1)
        got_imada = await asyncio.wait_for(mgr.imada_queue.get(), timeout=1)
        got_esp = await asyncio.wait_for(mgr.esp32_queue.get(), timeout=1)
        assert got_imada.force_n is not None
        assert got_esp.force_n is not None
    finally:
        await mgr.shutdown()
