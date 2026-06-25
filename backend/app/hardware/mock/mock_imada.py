from __future__ import annotations

import math
import threading
import time
from typing import Callable, List, Optional

from app.hardware.base import ImadaReading


class MockImada:
    """Emits a synthetic sine half-wave to simulate a tensile pull."""

    def __init__(self, rate_hz: int = 100, peak_n: float = 8.0, period_ms: int = 1000):
        self.rate_hz = rate_hz
        self.peak_n = peak_n
        self.period_ms = period_ms
        self._subs: List[Callable[[ImadaReading], None]] = []
        self._connected = False
        self._stop_event: Optional[threading.Event] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self.stop_stream()
        self._connected = False

    def subscribe(self, cb: Callable[[ImadaReading], None]) -> None:
        self._subs.append(cb)

    def start_stream(self) -> None:
        if self._thread is not None:
            return
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop_stream(self) -> None:
        if self._stop_event:
            self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1)
            self._thread = None
            self._stop_event = None

    def tare(self) -> None:
        pass  # no-op in mock mode

    def _run(self) -> None:
        period_s = self.period_ms / 1000.0
        interval = 1.0 / self.rate_hz
        t0 = time.monotonic()
        while self._stop_event and not self._stop_event.is_set():
            t = time.monotonic() - t0
            phase = (t % period_s) / period_s
            force = self.peak_n * math.sin(math.pi * phase)
            reading = ImadaReading(timestamp_ns=time.monotonic_ns(), force_n=force)
            for s in self._subs:
                try:
                    s(reading)
                except Exception:
                    pass
            time.sleep(interval)
