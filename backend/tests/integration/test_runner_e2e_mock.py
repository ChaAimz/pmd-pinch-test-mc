from __future__ import annotations

import asyncio

import pytest
from sqlmodel import SQLModel, Session, create_engine, select
from sqlmodel.pool import StaticPool

from app.config import (
    Esp32Calibration,
    Esp32Config,
    HardwareConfig,
    ImadaConfig,
    PlcConfig,
    ServerConfig,
    Settings,
    StateTimeouts,
    StorageConfig,
)
from app.db import engine as db_engine
from app.db.models import Recipe, TestLoop, TestRun
from app.hardware.manager import HardwareManager
from app.services.event_bus import EventBus
from app.services.state_machine import RunMode
from app.services.test_runner import TestRunner
from app.services.waveform import WaveformService


def _settings(wf_dir) -> Settings:
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
        storage=StorageConfig(db_url="sqlite://", waveforms_dir=str(wf_dir)),
        server=ServerConfig(),
        mock_mode=True,
    )


@pytest.mark.asyncio
async def test_full_session_two_loops_pass(tmp_path):
    e = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(e)
    db_engine._engine = e

    with Session(e) as s:
        r = Recipe(
            name="e2e",
            position_mm=10.0,
            speed_mms=5.0,
            clamp_threshold_n=5.0,
            loop_count=2,
            min_force_n=1.0,
            max_force_n=10.0,
            hold_time_ms=100,
            sampling_hz=100,
            created_at=_now_iso(),
            updated_at=_now_iso(),
        )
        s.add(r)
        s.commit()
        s.refresh(r)
        recipe = r

    settings = _settings(tmp_path)
    manager = HardwareManager(settings)
    bus = EventBus()
    waveform = WaveformService(base_dir=tmp_path)
    await manager.start()
    runner = TestRunner(settings, manager, bus, waveform)

    run_id = await runner.start(
        recipe, operator="op", batch_id="b", shift="A", mode=RunMode.AUTO
    )

    # Wait until the runner task completes (mock script ~600+600+100 ms per loop × 2)
    for _ in range(80):
        if runner._task is None or runner._task.done():
            break
        await asyncio.sleep(0.1)

    if runner._task is not None and not runner._task.done():
        # Allow up to 10 s total for slow CI
        await asyncio.wait_for(runner._task, timeout=10.0)

    await manager.shutdown()

    with Session(e) as s:
        run = s.get(TestRun, run_id)
        assert run is not None, "TestRun row missing"
        assert run.status in ("pass", "fail"), f"unexpected status: {run.status!r}"
        assert run.loops_completed == 2, f"expected 2 loops, got {run.loops_completed}"
        loops = list(s.exec(select(TestLoop).where(TestLoop.run_id == run_id)).all())
        assert len(loops) == 2, f"expected 2 TestLoop rows, got {len(loops)}"
        for loop in loops:
            assert loop.judgment in ("pass", "fail"), f"loop judgment unexpected: {loop.judgment!r}"
            assert loop.peak_force_n is not None
            assert loop.waveform_file is not None


@pytest.mark.asyncio
async def test_abort_mid_session(tmp_path):
    e = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(e)
    db_engine._engine = e

    with Session(e) as s:
        r = Recipe(
            name="e2e_abort",
            position_mm=10.0,
            speed_mms=5.0,
            clamp_threshold_n=5.0,
            loop_count=3,
            min_force_n=1.0,
            max_force_n=10.0,
            hold_time_ms=100,
            sampling_hz=100,
            created_at=_now_iso(),
            updated_at=_now_iso(),
        )
        s.add(r)
        s.commit()
        s.refresh(r)
        recipe = r

    settings = _settings(tmp_path)
    manager = HardwareManager(settings)
    bus = EventBus()
    waveform = WaveformService(base_dir=tmp_path)
    await manager.start()
    runner = TestRunner(settings, manager, bus, waveform)

    run_id = await runner.start(
        recipe, operator="op", batch_id="abort_test", shift="A", mode=RunMode.AUTO
    )

    # Abort after a short delay
    await asyncio.sleep(0.3)
    await runner.request_abort()

    # Wait for task to finish
    for _ in range(50):
        if runner._task is None or runner._task.done():
            break
        await asyncio.sleep(0.1)

    if runner._task is not None and not runner._task.done():
        await asyncio.wait_for(runner._task, timeout=5.0)

    await manager.shutdown()

    with Session(e) as s:
        run = s.get(TestRun, run_id)
        assert run is not None
        assert run.status == "aborted", f"expected aborted, got {run.status!r}"


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
