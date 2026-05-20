from __future__ import annotations

import threading
import time
from typing import Callable, List, Optional

from app.hardware.base import Esp32Reading


class MockEsp32:
    """Emits a ramp from 0 to target_n over ramp_ms and then holds."""

    def __init__(
        self,
        rate_hz: int = 100,
        target_n: float = 7.0,
        ramp_ms: int = 500,
        slope: float = 0.01,
        offset: float = 0.0,
    ):
        self.rate_hz = rate_hz
        self.target_n = target_n
        self.ramp_ms = ramp_ms
        self.slope = slope
        self.offset = offset
        self._subs: List[Callable[[Esp32Reading], None]] = []
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

    def subscribe(self, cb: Callable[[Esp32Reading], None]) -> None:
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

    def _run(self) -> None:
        ramp_s = self.ramp_ms / 1000.0
        interval = 1.0 / self.rate_hz
        t0 = time.monotonic()
        while self._stop_event and not self._stop_event.is_set():
            t = time.monotonic() - t0
            if t < ramp_s:
                force = self.target_n * (t / ramp_s)
            else:
                force = self.target_n
            raw = int((force - self.offset) / self.slope) if self.slope != 0 else 0
            reading = Esp32Reading(timestamp_ns=time.monotonic_ns(), force_n=force, raw=raw)
            for s in self._subs:
                try:
                    s(reading)
                except Exception:
                    pass
            time.sleep(interval)
