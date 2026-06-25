from __future__ import annotations

import asyncio
import time
from typing import List, Optional

from loguru import logger

from app.config import Settings
from app.hardware.base import GF_PER_N, Esp32Reading, ImadaReading, PlcEvent
from app.hardware.mock.mock_esp32 import MockEsp32
from app.hardware.mock.mock_imada import MockImada
from app.hardware.mock.mock_plc import MockPlc, MockPlcScript

# Live-stream broadcast cadence. Smaller = more WS traffic, fresher chart.
# 50 ms = 20 batches/sec; each batch holds however many samples arrived in that window.
_BROADCAST_INTERVAL_NS = 50_000_000  # 50 ms

# How often the watchdog tries to bring offline devices back online.
# 5 s is conservative — long enough that we don't hammer the serial layer with
# retry storms when a device is physically absent, short enough that operators
# don't have to wait when they plug a device in mid-session.
_RECONNECT_INTERVAL_S = 5.0


class HardwareManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.plc: Optional[MockPlc] = None
        self.imada: Optional[MockImada] = None
        self.esp32: Optional[MockEsp32] = None
        self.plc_event_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self.imada_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.esp32_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)

        # Live-broadcast buffers (touched only by their respective driver thread).
        self._t_baseline_ns: int = time.monotonic_ns()
        self._imada_buf: List[list] = []
        self._imada_last_emit_ns: int = 0
        self._esp32_buf: List[list] = []
        self._esp32_last_emit_ns: int = 0

        # Background reconnect watchdog
        self._reconnect_task: Optional[asyncio.Task] = None

        # ESP32 force-limit protection
        self._esp32_force_limit_gf: Optional[float] = None
        self._esp32_force_limit_gf_config: Optional[float] = None  # value from config.yaml at startup
        self._esp32_limit_active: bool = False

        # ESP32 clamp offset — software offset applied to recipe clamp threshold
        self._esp32_clamp_offset_gf: float = 0.0

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        self._t_baseline_ns = time.monotonic_ns()
        hw = self.settings.hardware
        if self.settings.mock_mode:
            self.plc = MockPlc(script=MockPlcScript(
                after_mr803_to_mr805_ms=600,
                after_mr805_to_mr806_ms=600,
                after_mr806_to_mr807_ms=100,
            ))
            self.imada = MockImada(rate_hz=100, peak_n=8.0, period_ms=1000)
            self.esp32 = MockEsp32(
                rate_hz=100,
                target_n=8.0,
                ramp_ms=500,
                slope=hw.esp32.calibration.slope,
                offset=hw.esp32.calibration.offset,
            )
        else:
            from app.hardware.plc import RealPlc
            from app.hardware.imada import RealImada
            from app.hardware.esp32 import RealEsp32
            self.plc = RealPlc(hw.plc) if hw.plc.enabled else None
            self.imada = RealImada(hw.imada) if hw.imada.enabled else None
            self.esp32 = RealEsp32(hw.esp32) if hw.esp32.enabled else None

        # Seed force-limit from config (may be None = disabled).
        self._esp32_force_limit_gf = hw.esp32.force_limit_gf
        self._esp32_force_limit_gf_config = hw.esp32.force_limit_gf

        # Seed clamp offset from config.
        self._esp32_clamp_offset_gf = hw.esp32.clamp_offset_gf

        # Connect each device; failure of one must not block the others.
        for name, dev in (("plc", self.plc), ("imada", self.imada), ("esp32", self.esp32)):
            if dev is None:
                continue
            try:
                dev.connect()
            except Exception:
                logger.exception("{} failed to connect", name)

        if self.plc is not None:
            self.plc.subscribe(self._on_plc_event)
        if self.imada is not None:
            self.imada.subscribe(self._on_imada_reading)
        if self.esp32 is not None:
            self.esp32.subscribe(self._on_esp32_reading)

        # Start always-on sensor streams so the live readout works at idle.
        # Idempotent — test_runner may call start_*_stream() too with no effect.
        if self.imada is not None and self.imada.is_connected:
            self.imada.start_stream()
        if self.esp32 is not None and self.esp32.is_connected:
            self.esp32.start_stream()

        # Watchdog: poll for any disconnected device and try to bring it back.
        # Covers two cases: (a) device wasn't online when backend booted,
        # (b) device dropped mid-session (USB unplugged, brownout, etc.).
        if not self.settings.mock_mode:
            self._reconnect_task = asyncio.create_task(
                self._reconnect_loop(), name="hw-reconnect"
            )

    async def shutdown(self) -> None:
        if self._reconnect_task is not None:
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
            self._reconnect_task = None
        if self.plc is not None and self.plc.is_connected:
            try:
                self.plc.set_bit(801, True)  # MR801 = Stop/E-Stop
                self.plc.set_bit(802, True)  # MR802 = Reset
            except Exception:
                pass
            self.plc.disconnect()
        if self.imada is not None and self.imada.is_connected:
            self.imada.disconnect()
        if self.esp32 is not None and self.esp32.is_connected:
            self.esp32.disconnect()

    def start_imada_stream(self) -> None:
        if self.imada is not None:
            self.imada.start_stream()

    def stop_imada_stream(self) -> None:
        # No-op in live mode: stream is started at boot and stays on for the live readout.
        # Stopping here would silence the operator UI between tests.
        return

    def start_esp32_stream(self) -> None:
        if self.esp32 is not None:
            self.esp32.start_stream()

    def stop_esp32_stream(self) -> None:
        # No-op in live mode for the same reason as Imada.
        return

    # ------------------------------------------------------------------
    # ESP32 force-limit protection
    # ------------------------------------------------------------------

    def set_esp32_force_limit(self, limit_gf: Optional[float]) -> None:
        self._esp32_force_limit_gf = limit_gf
        # If limit is cleared, also clear the PLC bit so the ladder doesn't stay latched.
        if limit_gf is None and self._esp32_limit_active:
            self._esp32_limit_active = False
            if self.plc is not None and self.plc.is_connected:
                try:
                    self.plc.set_bit(810, False)
                except Exception:
                    logger.exception("Failed to clear MR810 on limit disable")

    def get_esp32_force_limit(self) -> Optional[float]:
        return self._esp32_force_limit_gf

    def get_esp32_force_limit_config(self) -> Optional[float]:
        return self._esp32_force_limit_gf_config

    def is_esp32_limit_active(self) -> bool:
        return self._esp32_limit_active

    def get_esp32_clamp_offset(self) -> float:
        return self._esp32_clamp_offset_gf

    def set_esp32_clamp_offset(self, offset_gf: float) -> None:
        self._esp32_clamp_offset_gf = offset_gf

    def _raise_clamp_force_alarm(self) -> None:
        """Hardware clamp-force limit (force_limit_gf) exceeded — always-on safety.

        Runs in the ESP32 reader thread (called from _on_esp32_reading). MR810 has
        already been set by the caller; the PLC ladder handles stop/reset from there.
        This method tells the UI to show the 'Clamp Force Sensor Alarm' dialog and
        forces any running test to ERROR. Fires once per limit crossing
        (gated by _esp32_limit_active).
        """
        if self.loop is None:
            return

        # 1. Raise the warning dialog on every connected UI client.
        try:
            from app.deps import get_ws_hub
            get_ws_hub().broadcast_threadsafe(
                {
                    "type": "clamp_force_alarm",
                    "message": "Clamp Force Sensor Alarm",
                    "limit_gf": self._esp32_force_limit_gf,
                },
                self.loop,
            )
        except Exception:
            logger.exception("Clamp-force alarm: WS broadcast failed")

        # 3. Force the running test (if any) to ERROR. notify_* touches asyncio
        #    primitives, so hop onto the loop thread first.
        try:
            from app.deps import get_runner
            runner = get_runner()
            self.loop.call_soon_threadsafe(runner.notify_clamp_force_alarm)
        except Exception:
            # Runner not initialised / not running — nothing to interrupt.
            pass

        logger.warning("CLAMP FORCE SENSOR ALARM — hardware force limit exceeded")

    # ------------------------------------------------------------------
    # Reconnect watchdog
    # ------------------------------------------------------------------

    async def _reconnect_loop(self) -> None:
        """Watch for offline devices and try to reconnect them every N seconds."""
        loop = asyncio.get_running_loop()
        while True:
            try:
                await asyncio.sleep(_RECONNECT_INTERVAL_S)
            except asyncio.CancelledError:
                return
            for name, dev in (
                ("plc", self.plc),
                ("imada", self.imada),
                ("esp32", self.esp32),
            ):
                if dev is None or dev.is_connected:
                    continue
                try:
                    # Driver IO is blocking — push to default executor so the
                    # event loop stays responsive while we retry serial open /
                    # subprocess spawn.
                    await loop.run_in_executor(None, self._reconnect_one, name, dev)
                except Exception:
                    logger.exception("{} auto-reconnect raised", name)

    def _reconnect_one(self, name: str, dev) -> None:
        """Single reconnect attempt for one device. Runs in executor thread."""
        try:
            dev.connect()
        except Exception as e:
            # Quiet at debug level — device may simply be unplugged.
            logger.debug("{} reconnect attempt failed: {}", name, e)
            return
        if not dev.is_connected:
            return
        logger.info("{} auto-reconnected", name)
        # Drivers preserve their subscriber list across disconnect/connect,
        # so we only need to (re)spawn the streaming worker.
        if name == "imada" and self.imada is not None:
            self.imada.start_stream()
        elif name == "esp32" and self.esp32 is not None:
            self.esp32.start_stream()
        # PLC connect() restarts its own event-poll thread internally.

    # ------------------------------------------------------------------
    # Driver thread callbacks
    # ------------------------------------------------------------------

    def _on_plc_event(self, evt: PlcEvent) -> None:
        self._push(self.plc_event_queue, evt)

        # MR808 HIGH → tare the ESP32 clamp sensor
        if evt.kind == "bit" and int(evt.addr) == 808 and bool(evt.value):
            if self.esp32 is not None and self.esp32.is_connected:
                try:
                    self.esp32.tare()
                except Exception:
                    logger.exception("ESP32 tare triggered by MR808 failed")

        # MR812 HIGH → tare the Imada force gauge
        if evt.kind == "bit" and int(evt.addr) == 812 and bool(evt.value):
            if self.imada is not None and self.imada.is_connected:
                try:
                    self.imada.tare()
                except Exception:
                    logger.exception("Imada tare triggered by MR812 failed")

        if self.loop is None:
            return
        try:
            from app.deps import get_ws_hub  # lazy — avoids circular import at module load
            hub = get_ws_hub()
            msg = {"type": "plc_bit", "addr": int(evt.addr), "value": bool(evt.value)}
            hub.broadcast_threadsafe(msg, self.loop)
        except RuntimeError:
            # Hub not yet initialised (early startup) — silently skip
            pass
        except Exception:
            pass

    def _on_imada_reading(self, r: ImadaReading) -> None:
        self._push(self.imada_queue, r)
        self._buffer_and_broadcast(
            r.timestamp_ns,
            r.force_n,
            self._imada_buf,
            "imada_batch",
            is_imada=True,
        )

    def _on_esp32_reading(self, r: Esp32Reading) -> None:
        self._push(self.esp32_queue, r)

        # Force-limit interlock: drive MR810 HIGH when force_n >= limit.
        # force_n is in Newtons; limit is stored in gf — convert before comparing.
        # 3 % hysteresis on the clear edge suppresses chatter at threshold.
        limit = self._esp32_force_limit_gf
        if limit is not None and self.plc is not None and self.plc.is_connected:
            limit_n = limit / GF_PER_N
            exceeded = r.force_n >= limit_n
            cleared = r.force_n < limit_n * 0.97
            if exceeded and not self._esp32_limit_active:
                self._esp32_limit_active = True
                try:
                    self.plc.set_bit(810, True)
                except Exception:
                    logger.exception("Failed to set MR810")
                # Hardware clamp-force limit hit → always-on safety alarm.
                self._raise_clamp_force_alarm()
            elif cleared and self._esp32_limit_active:
                self._esp32_limit_active = False
                try:
                    self.plc.set_bit(810, False)
                except Exception:
                    logger.exception("Failed to clear MR810")

        self._buffer_and_broadcast(
            r.timestamp_ns,
            r.force_n,
            self._esp32_buf,
            "esp32_batch",
            is_imada=False,
        )

    # ------------------------------------------------------------------
    # Live broadcast (always-on, regardless of test state)
    # ------------------------------------------------------------------

    def _buffer_and_broadcast(
        self,
        ts_ns: int,
        force_n: float,
        buf: List[list],
        msg_type: str,
        is_imada: bool,
    ) -> None:
        t_ms = (ts_ns - self._t_baseline_ns) // 1_000_000
        buf.append([t_ms, force_n])
        last_emit_ns = self._imada_last_emit_ns if is_imada else self._esp32_last_emit_ns
        if ts_ns - last_emit_ns < _BROADCAST_INTERVAL_NS:
            return
        if is_imada:
            self._imada_last_emit_ns = ts_ns
        else:
            self._esp32_last_emit_ns = ts_ns

        samples = list(buf)
        buf.clear()
        if self.loop is None:
            return
        try:
            from app.deps import get_ws_hub
            hub = get_ws_hub()
            hub.broadcast_threadsafe(
                {"type": msg_type, "samples": samples},
                self.loop,
            )
        except RuntimeError:
            pass
        except Exception:
            logger.exception("{} broadcast failed", msg_type)

    def _push(self, q: asyncio.Queue, item) -> None:
        if self.loop is None:
            return
        self.loop.call_soon_threadsafe(self._enqueue, q, item)

    @staticmethod
    def _enqueue(q: asyncio.Queue, item) -> None:
        try:
            q.put_nowait(item)
        except asyncio.QueueFull:
            try:
                q.get_nowait()
            except Exception:
                pass
            try:
                q.put_nowait(item)
            except Exception:
                pass
