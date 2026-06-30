from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from app.hardware.base import PlcEvent


@dataclass
class MockPlcScript:
    """Optional script that auto-emits PLC bits to simulate the rig.

    The mock now models the PLC as the owner of the clamp cycle (matching the
    real-hardware contract where the PLC drives MR803 itself). It is reactive,
    paced by the backend's own bit writes:

      MR800 ↑ (Start)        → press clamp for loop 1 (MR803 ↑ after before_mr803_ms)
      MR804 ↑ (Clamp Stop)   → run tension cycle (MR805 ↑, then MR806 ↑)
      MR804 ↓ (Unclamp)      → drop MR803/805/806; press clamp again for the next
                               loop, or raise MR807 (Finish All) after the last loop.

    before_mr803_ms:        delay simulating the PLC moving + pressing the clamp
    after_mr803_to_mr805_ms: delay between Clamp Stop (MR804) and MR805 (Start Tension)
    after_mr805_to_mr806_ms: delay between MR805 and MR806 (End Loop)
    after_mr806_to_mr807_ms: delay before MR807 (Finish All) on the final loop
    """

    before_mr803_ms: int = 100
    after_mr803_to_mr805_ms: int = 50
    after_mr805_to_mr806_ms: int = 200
    after_mr806_to_mr807_ms: int = 50
    final_mr807: bool = True
    # On the final loop, also drive MR814 (Loops Complete ack) HIGH after MR807 so the
    # UI raises its "Complete Loops" confirm dialog. The operator confirms by writing
    # MR814 LOW (Web→PLC); the real PLC ladder owns this handshake on hardware.
    final_mr814: bool = True


class MockPlc:
    def __init__(self, script: Optional[MockPlcScript] = None):
        self._words: Dict[int, int] = {}
        # MR303 (Machine Ready) ON by default — mock rig is always safe to start.
        self._bits: Dict[int, bool] = {303: True}
        self._lock = threading.Lock()
        self._subs: List[Callable[[PlcEvent], None]] = []
        self._connected = False
        self._script = script
        self._loops_pressed = 0  # how many times we've pressed the clamp this run

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
            if self._script is not None:
                self._script_react(addr, on)

    def read_bit(self, addr: int) -> bool:
        with self._lock:
            return self._bits.get(addr, False)

    # ------------------------------------------------------------------
    # Reactive script (simulates the PLC ladder driving the clamp cycle)
    # ------------------------------------------------------------------

    def _script_react(self, addr: int, on: bool) -> None:
        # Only react to the backend's own writes (Web→PLC bits). Bits we emit
        # ourselves (803/805/806/807) re-enter here too, but none match below.
        if addr == 800 and on:
            self._loops_pressed = 0
            # Clear any stale Loops-Complete ack from a previous run on a fresh start.
            self.set_bit(814, False)
            self._press_clamp()
        elif addr == 804 and on:
            # Backend acknowledged clamp force → run the tension cycle.
            threading.Thread(target=self._tension_seq, daemon=True).start()
        elif addr == 804 and not on:
            # Backend unclamped → next loop or finish.
            threading.Thread(target=self._after_unclamp, daemon=True).start()

    def _press_clamp(self) -> None:
        def run() -> None:
            time.sleep(self._script.before_mr803_ms / 1000)
            with self._lock:
                self._loops_pressed += 1
            self.set_bit(803, True)  # PLC presses the clamp
        threading.Thread(target=run, daemon=True).start()

    def _tension_seq(self) -> None:
        time.sleep(self._script.after_mr803_to_mr805_ms / 1000)
        if not self._connected:
            return
        self.set_bit(805, True)
        time.sleep(self._script.after_mr805_to_mr806_ms / 1000)
        if not self._connected:
            return
        self.set_bit(806, True)

    def _after_unclamp(self) -> None:
        if not self._connected:
            return
        loop_count = self.read_word(0) or 1
        with self._lock:
            loops_done = self._loops_pressed
        # De-assert the PLC-owned per-loop bits, like a real ladder would.
        self.set_bit(803, False)
        self.set_bit(805, False)
        self.set_bit(806, False)
        if loops_done >= loop_count:
            time.sleep(self._script.after_mr806_to_mr807_ms / 1000)
            if not self._connected:
                return
            if self._script.final_mr807:
                self.set_bit(807, True)  # Finish All Loops
            if self._script.final_mr814:
                self.set_bit(814, True)  # Loops Complete — UI raises confirm dialog
        else:
            self._press_clamp()  # press again for the next loop
