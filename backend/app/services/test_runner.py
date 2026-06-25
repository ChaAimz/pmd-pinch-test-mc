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
from app.hardware.base import GF_PER_N, PlcEvent, ImadaReading, Esp32Reading
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
        self._error_requested: bool = False
        self._reset: asyncio.Event = asyncio.Event()
        self._b5_at: Optional[int] = None
        self._b6_t_ms: Optional[int] = None  # ms from B5 when B6 fired; set in _collect_tension
        self._peak_clamp_n: Optional[float] = None  # ESP32 force at MR804 trigger
        self._clamp_buffer: List[float] = []         # ESP32 force readings during B5→B6
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
        self._error_requested = False
        self._reset.clear()
        self._manual_clamp.clear()

        # Flush stale hardware events left by any previous session so that
        # orphaned mock/driver thread emissions don't corrupt the new session.
        for _q in (self.manager.plc_event_queue, self.manager.imada_queue, self.manager.esp32_queue):
            while True:
                try:
                    _q.get_nowait()
                except asyncio.QueueEmpty:
                    break

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
            await asyncio.get_running_loop().run_in_executor(
                None, self.manager.plc.set_bit, 801, True  # MR801 Stop/E-Stop
            )

    def notify_clamp_force_alarm(self) -> None:
        """Hardware clamp-force limit (force_limit_gf) exceeded — always-on safety.

        Raised by HardwareManager from the ESP32 reader thread via
        loop.call_soon_threadsafe, so this runs on the event-loop thread and may
        touch asyncio primitives safely. Forces the running test to ERROR and
        breaks out of any wait. The PLC safe-state bits (MR804/MR801/MR802) are
        driven by the manager, not here.
        """
        self._error_requested = True
        self._abort.set()          # all wait loops poll _abort → they bail out
        self._manual_clamp.set()   # unblock the LOOP_BEGIN manual-clamp wait

    def _terminal_event(self) -> SmEvent:
        """Choose ABORT vs ERROR when a wait is interrupted.

        A clamp-force alarm always forces ERROR (operator must Reset); otherwise
        an operator Stop is ABORT, and anything else (timeout) is ERROR.
        """
        if self._error_requested:
            return SmEvent.ERROR
        return SmEvent.ABORT if self._abort.is_set() else SmEvent.ERROR

    async def request_reset(self) -> None:
        self._reset.set()
        if self.manager.plc:
            await asyncio.get_running_loop().run_in_executor(
                None, self.manager.plc.set_bit, 802, True  # MR802 Reset
            )

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
        plc = self.manager.plc
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_ms / 1000
        _last_direct_poll = loop.time()
        _POLL_S = 0.5
        logger.debug("_wait_for_bit({}): start timeout={} ms", addr, timeout_ms)
        while loop.time() < deadline:
            if self._abort.is_set():
                logger.debug("_wait_for_bit({}): aborted", addr)
                return False
            try:
                evt: PlcEvent = await asyncio.wait_for(
                    self.manager.plc_event_queue.get(), timeout=0.1
                )
            except asyncio.TimeoutError:
                now = loop.time()
                if plc is not None and plc.is_connected and now - _last_direct_poll >= _POLL_S:
                    _last_direct_poll = now
                    try:
                        val = await loop.run_in_executor(None, plc.read_bit, addr)
                        if val:
                            logger.debug("_wait_for_bit({}): HIGH via direct read_bit fallback", addr)
                            return True
                    except Exception as exc:
                        logger.debug("_wait_for_bit({}): read_bit fallback failed: {}", addr, exc)
                continue
            logger.debug("_wait_for_bit({}): evt addr={} value={}", addr, evt.addr, evt.value)
            if evt.kind == "bit" and evt.addr == addr and evt.value:
                logger.debug("_wait_for_bit({}): matched via event", addr)
                return True
        logger.warning("_wait_for_bit({}): TIMEOUT after {} ms", addr, timeout_ms)
        return False

    async def _run_loop(self) -> None:
        sm = self._sm
        plc = self.manager.plc
        recipe = self._recipe
        assert sm and plc and recipe

        # Write params and signal PLC start (batched into one executor call to avoid
        # blocking the event loop 6× for the HTTP round-trips to the bridge process).
        sm.dispatch(SmEvent.START)
        await asyncio.get_running_loop().run_in_executor(
            None, self._write_start_params, plc, recipe
        )
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
                    sm.dispatch(self._terminal_event())
                    break

                # LOOP_BEGIN -> CLAMP_PRESSED
                if sm.state == State.LOOP_BEGIN:
                    self._peak_clamp_n = None  # reset per-loop clamp capture
                    if self._mode == RunMode.MANUAL:
                        self._manual_clamp.clear()
                        try:
                            await asyncio.wait_for(
                                self._manual_clamp.wait(),
                                timeout=timeouts.wait_clamp_press_ms / 1000,
                            )
                        except asyncio.TimeoutError:
                            sm.dispatch(self._terminal_event())
                            break
                        sm.dispatch(SmEvent.MANUAL_CLAMP_REQUESTED)
                    else:
                        sm.dispatch(SmEvent.AUTO_TRIGGER_CLAMP)

                # CLAMP_PRESSED — wait for PLC to drive MR803 HIGH.
                # On timeout, retry instead of erroring so a slow PLC ladder
                # (prepare time, mechanical positioning) doesn't abort the run.
                # Only a deliberate Stop/E-Stop (abort) will exit here.
                if sm.state == State.CLAMP_PRESSED:
                    if not await self._wait_for_bit(803, timeouts.wait_clamp_press_ms):
                        continue  # timeout → retry; abort is caught at top of loop
                    mr803_ns = time.monotonic_ns()
                    self.manager.start_esp32_stream()
                    sm.dispatch(SmEvent.CLAMP_PRESSED_ACK)

                # WAIT_CLAMP_FORCE
                if sm.state == State.WAIT_CLAMP_FORCE:
                    clamp_force_at_stop = await self._wait_for_clamp_force(
                        recipe.clamp_threshold_n, timeouts.wait_clamp_force_ms, mr803_ns
                    )
                    if clamp_force_at_stop is None:
                        # Either operator Stop, timeout, or a hardware clamp-force
                        # alarm (force_limit_gf) raised by the manager → ERROR.
                        sm.dispatch(self._terminal_event())
                        break
                    self._peak_clamp_n = clamp_force_at_stop
                    await asyncio.get_running_loop().run_in_executor(
                        None, plc.set_bit, 804, True  # MR804 Clamp Stop — recipe clamp force limit reached
                    )
                    self.manager.stop_esp32_stream()
                    sm.dispatch(SmEvent.CLAMP_FORCE_REACHED)

                # WAIT_MR805
                if sm.state == State.WAIT_B5:
                    if not await self._wait_for_bit(805, timeouts.wait_b5_ms):
                        sm.dispatch(self._terminal_event())
                        break
                    sm.dispatch(SmEvent.B5_RECEIVED)

                # TENSION_CHECK
                if sm.state == State.TENSION_CHECK:
                    self._b5_at = time.monotonic_ns()
                    self._b6_t_ms = None
                    self._clamp_buffer = []
                    self._buffer = []
                    self._loop_start_iso = _now_iso()
                    self.manager.start_imada_stream()
                    await self._collect_tension(timeouts.tension_check_ms)
                    self.manager.stop_imada_stream()
                    if self._abort.is_set():
                        sm.dispatch(self._terminal_event())
                        break
                    if self._b6_t_ms is None:
                        # _collect_tension timed out — PLC never sent MR806
                        logger.warning("Tension check timed out (no MR806) on loop {}", sm.current_loop)
                        sm.dispatch(SmEvent.ERROR)
                        break
                    sm.dispatch(SmEvent.B6_RECEIVED)

                # EVALUATE
                if sm.state == State.EVALUATE:
                    # Trim to (MR805 + start_offset)→MR806 window before persisting.
                    # start_offset skips the mechanical delay at the beginning of the
                    # tension stroke; _b6_t_ms caps the end at the exact MR806 fire time.
                    start_ms = self.settings.hardware.state_timeouts.tension_start_offset_ms
                    end_ms = self._b6_t_ms
                    buffer = [
                        s for s in self._buffer
                        if s.t_ms >= start_ms and (end_ms is None or s.t_ms <= end_ms)
                    ]
                    summary = self.waveform.summarize(buffer)
                    waveform_path = self.waveform.write_loop(
                        self._run_id, sm.current_loop, buffer
                    )
                    judgment = self._judge(summary, recipe)
                    avg_clamp_n = (
                        sum(self._clamp_buffer) / len(self._clamp_buffer)
                        if self._clamp_buffer else None
                    )
                    with Session(get_engine()) as s:
                        loop_row = TestLoop(
                            run_id=self._run_id,
                            loop_index=sm.current_loop,
                            started_at=self._loop_start_iso or _now_iso(),
                            finished_at=_now_iso(),
                            peak_force_n=summary.peak_force_n,
                            min_force_n=summary.min_force_n,
                            avg_force_n=summary.avg_force_n,
                            hold_time_ms=summary.hold_time_ms,
                            tension_end_ms=self._b6_t_ms,
                            peak_clamp_n=self._peak_clamp_n,
                            avg_clamp_n=avg_clamp_n,
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
                            "min_force_n": summary.min_force_n,
                            "avg_force_n": summary.avg_force_n,
                            "hold_time_ms": summary.hold_time_ms,
                            "tension_end_ms": self._b6_t_ms,
                            "peak_clamp_n": self._peak_clamp_n,
                            "avg_clamp_n": avg_clamp_n,
                            "judgment": judgment,
                        }
                    )
                    sm.dispatch(SmEvent.EVALUATION_DONE)

                # UNCLAMP
                if sm.state == State.UNCLAMP:
                    # MR804 is the only clamp bit the backend owns; release it.
                    await asyncio.get_running_loop().run_in_executor(
                        None, plc.set_bit, 804, False  # MR804 release clamp stop
                    )
                    # MR803 (Press Clamp) and MR805/806/807 are PLC-owned now —
                    # the PLC (or the mock simulating it) de-asserts them itself and
                    # re-presses MR803 for the next loop. The wait helpers skip stale
                    # events, so no manual queue flush is needed here.
                    sm.dispatch(SmEvent.UNCLAMP_DONE)

            # DONE_B7 or terminal
            if sm.state == State.DONE_B7:
                if await self._wait_for_bit(
                    807, self.settings.hardware.state_timeouts.done_b7_ms
                ):
                    sm.dispatch(SmEvent.B7_RECEIVED)
                else:
                    sm.dispatch(SmEvent.ERROR)

        except Exception as exc:
            logger.exception("TestRunner._run_loop unhandled exception: {}", exc)
            if sm.state not in (State.ABORTED, State.ERROR, State.IDLE):
                sm.dispatch(SmEvent.ERROR)

        await self._finalize()

    async def _wait_for_clamp_force(
        self, recipe_limit_n: float, timeout_ms: int, since_ns: int
    ) -> Optional[float]:
        # Returns the ESP32 force_n reading that triggered MR804 (>= recipe_limit_n),
        # or None on abort / hardware-limit alarm / timeout.
        # since_ns skips stale readings from the previous loop's clamp press.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_ms / 1000
        while loop.time() < deadline:
            if self._abort.is_set():
                return None
            try:
                r: Esp32Reading = await asyncio.wait_for(
                    self.manager.esp32_queue.get(), timeout=0.05
                )
            except asyncio.TimeoutError:
                continue
            if r.timestamp_ns < since_ns:
                continue  # stale from previous loop — skip
            offset_n = self.manager.get_esp32_clamp_offset() / GF_PER_N
            if r.force_n >= recipe_limit_n + offset_n:
                logger.debug(
                    "Clamp force reached: {:.2f} N >= {:.2f} N (recipe) + {:.4f} N (offset) → MR804",
                    r.force_n, recipe_limit_n, offset_n,
                )
                return r.force_n
        logger.warning(
            "_wait_for_clamp_force timed out after {} ms (limit {:.2f} N)",
            timeout_ms, recipe_limit_n,
        )
        return None

    async def _collect_tension(self, timeout_ms: int) -> None:
        # Note: imada_batch WS broadcast is now done by HardwareManager (always-on).
        # Here we only consume the queue to fill the parquet buffer and watch for B6.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_ms / 1000
        while loop.time() < deadline:
            if self._abort.is_set():
                return
            # Drain all immediately available PLC events. Re-queue non-MR806 events so
            # _wait_for_bit(807) and other callers can still see them after we return.
            leftover: list[PlcEvent] = []
            try:
                while True:
                    evt: PlcEvent = self.manager.plc_event_queue.get_nowait()
                    if evt.kind == "bit" and evt.addr == 806 and evt.value:  # MR806
                        self._b6_t_ms = int((time.monotonic_ns() - self._b5_at) / 1_000_000)
                        for e in leftover:
                            try:
                                self.manager.plc_event_queue.put_nowait(e)
                            except asyncio.QueueFull:
                                logger.warning("_collect_tension: queue full, dropped event addr={}", e.addr)
                        return
                    leftover.append(evt)
            except asyncio.QueueEmpty:
                for e in leftover:
                    try:
                        self.manager.plc_event_queue.put_nowait(e)
                    except asyncio.QueueFull:
                        logger.warning("_collect_tension: queue full, dropped event addr={}", e.addr)
            # Drain available ESP32 clamp readings in the B5→B6 window (non-blocking)
            try:
                while True:
                    er: Esp32Reading = self.manager.esp32_queue.get_nowait()
                    if er.timestamp_ns >= self._b5_at:
                        self._clamp_buffer.append(er.force_n)
            except asyncio.QueueEmpty:
                pass
            # Collect Imada sample for the parquet record
            try:
                r: ImadaReading = await asyncio.wait_for(
                    self.manager.imada_queue.get(), timeout=0.02
                )
            except asyncio.TimeoutError:
                continue
            t_ms = int((r.timestamp_ns - self._b5_at) / 1_000_000)  # relative to MR805
            if t_ms < 0:
                # Stale Imada sample queued before MR805 fired. Drop it (mirrors the
                # ESP32 path above which skips pre-B5 readings). Previously this was
                # clamped to t_ms=0, which piled the whole pre-tension baseline — incl.
                # its negative settling values — onto a single t_ms=0 column, rendering
                # as a negative spike at every cycle boundary in the stitched chart.
                continue
            self._buffer.append(WaveformSample(t_ms=t_ms, force_n=r.force_n))

    @staticmethod
    def _write_start_params(plc, recipe: Recipe) -> None:
        """Batch all startup PLC writes into one executor call (each is a blocking HTTP round-trip)."""
        plc.write_word(100, int(recipe.position_mm * 100))
        plc.write_word(102, int(recipe.speed_mms * 100))
        plc.write_word(0, recipe.loop_count)
        plc.write_word(103, int(recipe.diameter_mm * 100))
        plc.write_word(104, recipe.prepare_timer_s * 10)
        plc.set_bit(800, True)  # MR800 Start

    def _judge(self, summary, recipe: Recipe) -> str:
        """Pass iff peak force is within [min_force_n, max_force_n].

        hold_time_ms is no longer a pass/fail criterion — the PLC controls all
        timing via MR805 (start) and MR806 (end).  hold_time_ms in the loop
        record is the measured B5→B6 duration, stored for informational purposes.
        """
        ok = True
        if recipe.min_force_n is not None and summary.peak_force_n < recipe.min_force_n:
            ok = False
        if recipe.max_force_n is not None and summary.peak_force_n > recipe.max_force_n:
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
