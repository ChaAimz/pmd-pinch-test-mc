import asyncio
import time

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
from app.hardware.base import ImadaReading
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


@pytest.mark.asyncio
async def test_imada_tension_limit_latches_mr815_and_does_not_autoclear(tmp_path):
    mgr = HardwareManager(_settings(tmp_path))
    await mgr.start()
    try:
        mgr.set_imada_tension_limit(2.0)
        assert mgr.get_imada_tension_limit() == 2.0
        assert mgr.is_imada_tension_alarm_active() is False

        # Below limit — no change.
        mgr._on_imada_reading(ImadaReading(timestamp_ns=time.monotonic_ns(), force_n=1.0))
        assert mgr.is_imada_tension_alarm_active() is False
        assert mgr.plc.read_bit(815) is False

        # Crosses the limit — latches on, MR815 HIGH.
        mgr._on_imada_reading(ImadaReading(timestamp_ns=time.monotonic_ns(), force_n=2.5))
        assert mgr.is_imada_tension_alarm_active() is True
        assert mgr.plc.read_bit(815) is True

        # Drops back below limit — no auto-clear (unlike MR810's hysteresis).
        mgr._on_imada_reading(ImadaReading(timestamp_ns=time.monotonic_ns(), force_n=0.0))
        assert mgr.is_imada_tension_alarm_active() is True
        assert mgr.plc.read_bit(815) is True

        # Operator acknowledges — latch clears and MR815 goes LOW.
        mgr.acknowledge_imada_tension_alarm()
        assert mgr.is_imada_tension_alarm_active() is False
        assert mgr.plc.read_bit(815) is False
    finally:
        await mgr.shutdown()


@pytest.mark.asyncio
async def test_imada_tension_limit_disabled_when_none(tmp_path):
    mgr = HardwareManager(_settings(tmp_path))
    await mgr.start()
    try:
        mgr.set_imada_tension_limit(None)
        mgr._on_imada_reading(ImadaReading(timestamp_ns=time.monotonic_ns(), force_n=100.0))
        assert mgr.is_imada_tension_alarm_active() is False
        assert mgr.plc.read_bit(815) is False
    finally:
        await mgr.shutdown()
