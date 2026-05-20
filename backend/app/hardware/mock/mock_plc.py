from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from app.hardware.base import PlcEvent


@dataclass
class MockPlcScript:
    """Optional script that auto-emits PLC bits to simulate the rig.

    after_b3_to_b5_ms: delay between B3 being set and B5 turning on
    after_b5_to_b6_ms: delay between B5 and B6 turning on (tension check)
    after_b6_to_b7_ms: delay between final loop B6 and B7 (finish)
    """

    after_b3_to_b5_ms: int = 50
    after_b5_to_b6_ms: int = 200
    after_b6_to_b7_ms: int = 50
    final_b7: bool = True


class MockPlc:
    def __init__(self, script: Optional[MockPlcScript] = None):
        self._words: Dict[int, int] = {}
        self._bits: Dict[int, bool] = {}
        self._lock = threading.Lock()
        self._subs: List[Callable[[PlcEvent], None]] = []
        self._connected = False
        self._script = script

    @property
    def is_connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def subscribe(self, cb: Callable[[PlcEvent], None]) -> None:
        self._subs.append(cb)

    def _emit(self, evt: PlcEvent) -> None:
        for s in self._subs:
            try:
                s(evt)
            except Exception:
                pass

    def write_word(self, addr: int, value: int) -> None:
        with self._lock:
            self._words[addr] = value
        self._emit(PlcEvent.word(addr, value, time.monotonic_ns()))

    def read_word(self, addr: int) -> int:
        with self._lock:
            return self._words.get(addr, 0)

    def set_bit(self, addr: int, on: bool) -> None:
        with self._lock:
            prev = self._bits.get(addr, False)
            self._bits[addr] = on
        if prev != on:
            self._emit(PlcEvent.bit(addr, on, time.monotonic_ns()))
            if self._script is not None and addr == 3 and on:
                threading.Thread(target=self._run_script, daemon=True).start()

    def read_bit(self, addr: int) -> bool:
        with self._lock:
            return self._bits.get(addr, False)

    def _run_script(self) -> None:
        time.sleep(self._script.after_b3_to_b5_ms / 1000)
        self.set_bit(5, True)
        time.sleep(self._script.after_b5_to_b6_ms / 1000)
        self.set_bit(6, True)
        time.sleep(self._script.after_b6_to_b7_ms / 1000)
        if self._script.final_b7:
            self.set_bit(7, True)
