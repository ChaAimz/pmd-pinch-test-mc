from __future__ import annotations

from enum import Enum
from typing import Callable, Dict, Optional, Tuple


class State(str, Enum):
    IDLE = "IDLE"
    WRITE_PLC_PARAMS = "WRITE_PLC_PARAMS"
    LOOP_BEGIN = "LOOP_BEGIN"
    CLAMP_PRESSED = "CLAMP_PRESSED"
    WAIT_CLAMP_FORCE = "WAIT_CLAMP_FORCE"
    WAIT_B5 = "WAIT_B5"
    TENSION_CHECK = "TENSION_CHECK"
    EVALUATE = "EVALUATE"
    UNCLAMP = "UNCLAMP"
    DONE_B7 = "DONE_B7"
    ABORTED = "ABORTED"
    ERROR = "ERROR"


class Event(str, Enum):
    START = "START"
    PARAMS_WRITTEN = "PARAMS_WRITTEN"
    AUTO_TRIGGER_CLAMP = "AUTO_TRIGGER_CLAMP"
    MANUAL_CLAMP_REQUESTED = "MANUAL_CLAMP_REQUESTED"
    CLAMP_PRESSED_ACK = "CLAMP_PRESSED_ACK"
    CLAMP_FORCE_REACHED = "CLAMP_FORCE_REACHED"
    B5_RECEIVED = "B5_RECEIVED"
    B6_RECEIVED = "B6_RECEIVED"
    EVALUATION_DONE = "EVALUATION_DONE"
    UNCLAMP_DONE = "UNCLAMP_DONE"
    B7_RECEIVED = "B7_RECEIVED"
    ABORT = "ABORT"
    RESET = "RESET"
    ERROR = "ERROR"


class RunMode(str, Enum):
    AUTO = "auto"
    MANUAL = "manual"


_TRANSITIONS: Dict[Tuple[State, Event], State] = {
    (State.IDLE, Event.START): State.WRITE_PLC_PARAMS,
    (State.WRITE_PLC_PARAMS, Event.PARAMS_WRITTEN): State.LOOP_BEGIN,
    (State.CLAMP_PRESSED, Event.CLAMP_PRESSED_ACK): State.WAIT_CLAMP_FORCE,
    (State.WAIT_CLAMP_FORCE, Event.CLAMP_FORCE_REACHED): State.WAIT_B5,
    (State.WAIT_B5, Event.B5_RECEIVED): State.TENSION_CHECK,
    (State.TENSION_CHECK, Event.B6_RECEIVED): State.EVALUATE,
    (State.EVALUATE, Event.EVALUATION_DONE): State.UNCLAMP,
    (State.DONE_B7, Event.B7_RECEIVED): State.IDLE,
}


class StateMachine:
    def __init__(self, loop_count: int, mode: RunMode):
        self.state: State = State.IDLE
        self.loop_count = loop_count
        self.mode = mode
        self.current_loop = 0
        self._listeners: list[Callable[[State, State, Event], None]] = []

    def add_listener(self, fn: Callable[[State, State, Event], None]) -> None:
        self._listeners.append(fn)

    def dispatch(self, event: Event) -> Optional[State]:
        if event == Event.ABORT and self.state not in (State.IDLE,):
            return self._transition(State.ABORTED, event)
        if event == Event.RESET and self.state in (State.ABORTED, State.ERROR):
            self.current_loop = 0
            return self._transition(State.IDLE, event)
        if event == Event.ERROR:
            return self._transition(State.ERROR, event)

        if self.state == State.LOOP_BEGIN:
            if event == Event.AUTO_TRIGGER_CLAMP and self.mode == RunMode.AUTO:
                self.current_loop += 1
                return self._transition(State.CLAMP_PRESSED, event)
            if event == Event.MANUAL_CLAMP_REQUESTED and self.mode == RunMode.MANUAL:
                self.current_loop += 1
                return self._transition(State.CLAMP_PRESSED, event)
            return None
        if self.state == State.UNCLAMP and event == Event.UNCLAMP_DONE:
            if self.current_loop < self.loop_count:
                return self._transition(State.LOOP_BEGIN, event)
            return self._transition(State.DONE_B7, event)

        key = (self.state, event)
        if key in _TRANSITIONS:
            return self._transition(_TRANSITIONS[key], event)
        return None

    def _transition(self, new_state: State, event: Event) -> State:
        old = self.state
        self.state = new_state
        for ln in self._listeners:
            try:
                ln(old, new_state, event)
            except Exception:
                pass
        return new_state
