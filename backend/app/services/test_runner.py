from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import List, Optional

import sqlmodel
from loguru import logger
from sqlmodel import Session, select

from app.config import Settings
from app.db.engine import get_engine
from app.db.models import Recipe, TestLoop, TestRun
from app.hardware.base import PlcEvent, ImadaReading, Esp32Reading
from app.hardware.manager import HardwareManager
from app.services.event_bus import EventBus
from app.services.state_machine import Event as SmEvent, RunMode, State, StateMachine
from app.services.waveform import WaveformSample, WaveformService


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class TestRunner:
    def __init__(
        self,
        settings: Settings,
        manager: HardwareManager,
        bus: EventBus,
        waveform: WaveformService,
    ):
        self.settings = settings
        self.manager = manager
        self.bus = bus
        self.waveform = waveform
        self._task: Optional[asyncio.Task] = None
        self._sm: Optional[StateMachine] = None
        self._run_id: Optional[int] = None
        self._recipe: Optional[Recipe] = None
        self._mode: Optional[RunMode] = None
        self._manual_clamp: asyncio.Event = asyncio.Event()
        self._abort: asyncio.Event = asyncio.Event()
        self._reset: asyncio.Event = asyncio.Event()
        self._b5_at: Optional[int] = None
        self._buffer: List[WaveformSample] = []
        self._loop_start_iso: Optional[str] = None

    # ----- public API -----

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(
        self,
        recipe: Recipe,
        operator: Optional[str],
        batch_id: Optional[str],
        shift: Optional[str],
        mode: RunMode,
    ) -> int:
        if self.is_running:
            raise RuntimeError("Runner already in session")
        self._recipe = recipe
        self._mode = mode
        self._abort.clear()
        self._reset.clear()
        self._manual_clamp.clear()

        with Session(get_engine()) as s:
            run = TestRun(
                recipe_id=recipe.id,
                operator=operator,
                batch_id=batch_id,
                shift=shift,
                started_at=_now_iso(),
                status="running",
                waveform_dir=None,  # filled in after we know run.id
            )
            s.add(run)
            s.commit()
            s.refresh(run)
            self._run_id = run.id
            # Now update waveform_dir with actual run_id
            run.waveform_dir = str(self.waveform.base_dir / str(run.id))
            s.add(run)
            s.commit()

        self._sm = StateMachine(loop_count=recipe.loop_count, mode=mode)
        self._sm.add_listener(self._on_state_change)
        self._task = asyncio.create_task(self._run_loop())
        return self._run_id

    async def request_manual_clamp(self) -> None:
        self._manual_clamp.set()

    async def request_abort(self) -> None:
        self._abort.set()
        if self.manager.plc:
            self.manager.plc.set_bit(1, True)

    async def request_reset(self) -> None:
        self._reset.set()
        if self.manager.plc:
            self.manager.plc.set_bit(2, True)

    # ----- internals -----

    def _on_state_change(self, old: State, new: State, evt: SmEvent) -> None:
        asyncio.create_task(
            self.bus.publish(
                {
                    "type": "state_change",
                    "run_id": self._run_id,
                    "from": old.value,
                    "to": new.value,
                    "loop": (self._sm.current_loop if self._sm else None),
                    "at": _now_iso(),
                }
            )
        )

    async def _publish(self, msg: dict) -> None:
        await self.bus.publish(msg)

    async def _wait_for_bit(self, addr: int, timeout_ms: int) -> bool:
        deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
        while asyncio.get_running_loop().time() < deadline:
            if self._abort.is_set():
                return False
            try:
                evt: PlcEvent = await asyncio.wait_for(
                    self.manager.plc_event_queue.get(), timeout=0.1
                )
            except asyncio.TimeoutError:
                continue
            await self._publish(
                {"type": "plc_bit", "addr": evt.addr, "value": bool(evt.value)}
            )
            if evt.kind == "bit" and evt.addr == addr and evt.value:
                return True
        return False

    async def _run_loop(self) -> None:
        sm = self._sm
        plc = self.manager.plc
        recipe = self._recipe
        assert sm and plc and recipe

        # Write params and signal PLC start
        sm.dispatch(SmEvent.START)
        plc.write_word(100, int(recipe.position_mm * 100))
        plc.write_word(102, int(recipe.speed_mms * 100))
        plc.write_word(0, recipe.loop_count)
        plc.set_bit(0, True)  # B0 = start
        sm.dispatch(SmEvent.PARAMS_WRITTEN)

        timeouts = self.settings.hardware.state_timeouts

        try:
            while sm.state in (
                State.LOOP_BEGIN,
                State.CLAMP_PRESSED,
                State.WAIT_CLAMP_FORCE,
                State.WAIT_B5,
                State.TENSION_CHECK,
                State.EVALUATE,
                State.UNCLAMP,
            ):
                if self._abort.is_set():
                    sm.dispatch(SmEvent.ABORT)
                    break

                # LOOP_BEGIN -> CLAMP_PRESSED
                if sm.state == State.LOOP_BEGIN:
                    if self._mode == RunMode.MANUAL:
                        self._manual_clamp.clear()
                        try:
                            await asyncio.wait_for(
                                self._manual_clamp.wait(),
                                timeout=timeouts.wait_b5_ms / 1000,
                            )
                        except asyncio.TimeoutError:
                            sm.dispatch(SmEvent.ABORT if self._abort.is_set() else SmEvent.ERROR)
                            break
                        sm.dispatch(SmEvent.MANUAL_CLAMP_REQUESTED)
                    else:
                        sm.dispatch(SmEvent.AUTO_TRIGGER_CLAMP)

                # CLAMP_PRESSED
                if sm.state == State.CLAMP_PRESSED:
                    plc.set_bit(3, True)  # press clamp
                    self.manager.start_esp32_stream()
                    sm.dispatch(SmEvent.CLAMP_PRESSED_ACK)

                # WAIT_CLAMP_FORCE
                if sm.state == State.WAIT_CLAMP_FORCE:
                    reached = await self._wait_for_clamp_force(
                        recipe.clamp_threshold_n, timeouts.wait_clamp_force_ms
                    )
                    if not reached:
                        sm.dispatch(SmEvent.ABORT if self._abort.is_set() else SmEvent.ERROR)
                        break
                    plc.set_bit(4, True)  # stop clamp actuator
                    # stop_stream() joins a thread — run in executor to avoid blocking the event loop
                    await asyncio.get_event_loop().run_in_executor(
                        None, self.manager.stop_esp32_stream
                    )
                    sm.dispatch(SmEvent.CLAMP_FORCE_REACHED)

                # WAIT_B5
                if sm.state == State.WAIT_B5:
                    if not await self._wait_for_bit(5, timeouts.wait_b5_ms):
                        sm.dispatch(SmEvent.ABORT if self._abort.is_set() else SmEvent.ERROR)
                        break
                    sm.dispatch(SmEvent.B5_RECEIVED)

                # TENSION_CHECK
                if sm.state == State.TENSION_CHECK:
                    self._b5_at = time.monotonic_ns()
                    self._buffer = []
                    self._loop_start_iso = _now_iso()
                    self.manager.start_imada_stream()
                    await self._collect_tension(timeouts.tension_check_ms)
                    # stop_stream() joins a thread — run in executor to avoid blocking the event loop
                    await asyncio.get_event_loop().run_in_executor(
                        None, self.manager.stop_imada_stream
                    )
                    if self._abort.is_set():
                        sm.dispatch(SmEvent.ABORT)
                        break
                    sm.dispatch(SmEvent.B6_RECEIVED)

                # EVALUATE
                if sm.state == State.EVALUATE:
                    summary = self.waveform.summarize(self._buffer, recipe.min_force_n)
                    waveform_path = self.waveform.write_loop(
                        self._run_id, sm.current_loop, self._buffer
                    )
                    judgment = self._judge(summary, recipe)
                    with Session(get_engine()) as s:
                        loop_row = TestLoop(
                            run_id=self._run_id,
                            loop_index=sm.current_loop,
                            started_at=self._loop_start_iso or _now_iso(),
                            finished_at=_now_iso(),
                            peak_force_n=summary.peak_force_n,
                            avg_force_n=summary.avg_force_n,
                            hold_time_ms=summary.hold_time_ms,
                            judgment=judgment,
                            waveform_file=waveform_path.name,
                        )
                        s.add(loop_row)
                        run = s.get(TestRun, self._run_id)
                        if run:
                            run.loops_completed = sm.current_loop
                        s.commit()
                    await self._publish(
                        {
                            "type": "loop_result",
                            "run_id": self._run_id,
                            "loop": sm.current_loop,
                            "peak_force_n": summary.peak_force_n,
                            "avg_force_n": summary.avg_force_n,
                            "hold_time_ms": summary.hold_time_ms,
                            "judgment": judgment,
                        }
                    )
                    sm.dispatch(SmEvent.EVALUATION_DONE)

                # UNCLAMP
                if sm.state == State.UNCLAMP:
                    plc.set_bit(3, False)
                    plc.set_bit(4, False)
                    # Reset B5/B6/B7 so mock script can re-fire them next loop.
                    # On real hardware the PLC de-asserts these internally; the mock
                    # only emits an event when the value changes, so we must clear them.
                    plc.set_bit(5, False)
                    plc.set_bit(6, False)
                    plc.set_bit(7, False)
                    # Flush any residual PLC events accumulated during the loop
                    while not self.manager.plc_event_queue.empty():
                        try:
                            self.manager.plc_event_queue.get_nowait()
                        except Exception:
                            break
                    sm.dispatch(SmEvent.UNCLAMP_DONE)

            # DONE_B7 or terminal
            if sm.state == State.DONE_B7:
                if await self._wait_for_bit(
                    7, self.settings.hardware.state_timeouts.done_b7_ms
                ):
                    sm.dispatch(SmEvent.B7_RECEIVED)
                else:
                    sm.dispatch(SmEvent.ERROR)

        except Exception as exc:
            logger.exception("TestRunner._run_loop unhandled exception: {}", exc)
            if sm.state not in (State.ABORTED, State.ERROR, State.IDLE):
                sm.dispatch(SmEvent.ERROR)

        await self._finalize()

    async def _wait_for_clamp_force(self, threshold_n: float, timeout_ms: int) -> bool:
        deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
        batch: List[List[float]] = []
        while asyncio.get_running_loop().time() < deadline:
            if self._abort.is_set():
                return False
            try:
                r: Esp32Reading = await asyncio.wait_for(
                    self.manager.esp32_queue.get(), timeout=0.05
                )
            except asyncio.TimeoutError:
                continue
            batch.append([0.0, r.force_n])
            if len(batch) >= 5:
                await self._publish(
                    {
                        "type": "esp32_batch",
                        "run_id": self._run_id,
                        "samples": batch,
                    }
                )
                batch = []
            if r.force_n >= threshold_n:
                if batch:
                    await self._publish(
                        {
                            "type": "esp32_batch",
                            "run_id": self._run_id,
                            "samples": batch,
                        }
                    )
                return True
        return False

    async def _collect_tension(self, timeout_ms: int) -> None:
        deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
        batch: List[List[float]] = []
        last_emit = asyncio.get_running_loop().time()
        while asyncio.get_running_loop().time() < deadline:
            if self._abort.is_set():
                return
            # Check for B6 (end of tension check) without blocking
            try:
                evt: PlcEvent = self.manager.plc_event_queue.get_nowait()
                await self._publish(
                    {"type": "plc_bit", "addr": evt.addr, "value": bool(evt.value)}
                )
                if evt.kind == "bit" and evt.addr == 6 and evt.value:
                    if batch:
                        await self._publish(
                            {
                                "type": "imada_batch",
                                "run_id": self._run_id,
                                "loop": self._sm.current_loop if self._sm else None,
                                "samples": batch,
                            }
                        )
                    return
            except asyncio.QueueEmpty:
                pass
            # Collect Imada sample
            try:
                r: ImadaReading = await asyncio.wait_for(
                    self.manager.imada_queue.get(), timeout=0.02
                )
            except asyncio.TimeoutError:
                continue
            t_ms = int((r.timestamp_ns - self._b5_at) / 1_000_000)
            if t_ms < 0:
                t_ms = 0
            self._buffer.append(WaveformSample(t_ms=t_ms, force_n=r.force_n))
            batch.append([t_ms, r.force_n])
            now = asyncio.get_running_loop().time()
            if now - last_emit >= 0.05:
                await self._publish(
                    {
                        "type": "imada_batch",
                        "run_id": self._run_id,
                        "loop": self._sm.current_loop if self._sm else None,
                        "samples": batch,
                    }
                )
                batch = []
                last_emit = now

    def _judge(self, summary, recipe: Recipe) -> str:
        ok = True
        if recipe.min_force_n is not None and summary.peak_force_n < recipe.min_force_n:
            ok = False
        if recipe.max_force_n is not None and summary.peak_force_n > recipe.max_force_n:
            ok = False
        if recipe.hold_time_ms is not None and summary.hold_time_ms < recipe.hold_time_ms:
            ok = False
        return "pass" if ok else "fail"

    async def _finalize(self) -> None:
        if self._run_id is None:
            return
        sm = self._sm
        with Session(get_engine()) as s:
            run = s.get(TestRun, self._run_id)
            if run is None:
                return
            if sm and sm.state == State.IDLE:
                rows = list(
                    s.exec(select(TestLoop).where(TestLoop.run_id == self._run_id)).all()
                )
                run.status = (
                    "pass" if all(r.judgment == "pass" for r in rows) and rows else "fail"
                )
            elif sm and sm.state == State.ABORTED:
                run.status = "aborted"
            else:
                run.status = "error"
            run.finished_at = _now_iso()
            s.add(run)
            s.commit()
        await self._publish(
            {
                "type": "run_finished",
                "run_id": self._run_id,
                "status": (sm.state.value if sm else "error"),
                "loops_completed": (sm.current_loop if sm else 0),
            }
        )
        self._task = None
        self._run_id = None
