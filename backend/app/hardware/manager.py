from __future__ import annotations

import asyncio
from typing import Optional

from app.config import Settings
from app.hardware.base import Esp32Reading, ImadaReading, PlcEvent
from app.hardware.mock.mock_esp32 import MockEsp32
from app.hardware.mock.mock_imada import MockImada
from app.hardware.mock.mock_plc import MockPlc, MockPlcScript


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

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        if self.settings.mock_mode:
            self.plc = MockPlc(script=MockPlcScript(
                after_b3_to_b5_ms=600,
                after_b5_to_b6_ms=600,
                after_b6_to_b7_ms=100,
            ))
            self.imada = MockImada(rate_hz=100, peak_n=8.0, period_ms=1000)
            self.esp32 = MockEsp32(
                rate_hz=100,
                target_n=8.0,
                ramp_ms=500,
                slope=self.settings.hardware.esp32.calibration.slope,
                offset=self.settings.hardware.esp32.calibration.offset,
            )
        else:
            raise NotImplementedError("real drivers added in Plan 3")

        self.plc.connect()
        self.imada.connect()
        self.esp32.connect()

        self.plc.subscribe(self._on_plc_event)
        self.imada.subscribe(self._on_imada_reading)
        self.esp32.subscribe(self._on_esp32_reading)

    async def shutdown(self) -> None:
        if self.plc:
            self.plc.set_bit(1, True)  # B1 = stop
            self.plc.set_bit(2, True)  # B2 = reset
            self.plc.disconnect()
        if self.imada:
            self.imada.disconnect()
        if self.esp32:
            self.esp32.disconnect()

    def start_imada_stream(self) -> None:
        assert self.imada
        self.imada.start_stream()

    def stop_imada_stream(self) -> None:
        assert self.imada
        self.imada.stop_stream()

    def start_esp32_stream(self) -> None:
        assert self.esp32
        self.esp32.start_stream()

    def stop_esp32_stream(self) -> None:
        assert self.esp32
        self.esp32.stop_stream()

    def _on_plc_event(self, evt: PlcEvent) -> None:
        self._push(self.plc_event_queue, evt)

    def _on_imada_reading(self, r: ImadaReading) -> None:
        self._push(self.imada_queue, r)

    def _on_esp32_reading(self, r: Esp32Reading) -> None:
        self._push(self.esp32_queue, r)

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
