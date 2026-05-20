from app.services.state_machine import Event, RunMode, State, StateMachine


def test_full_happy_path_auto_mode():
    sm = StateMachine(loop_count=2, mode=RunMode.AUTO)
    assert sm.state == State.IDLE

    sm.dispatch(Event.START)
    assert sm.state == State.WRITE_PLC_PARAMS

    sm.dispatch(Event.PARAMS_WRITTEN)
    assert sm.state == State.LOOP_BEGIN

    sm.dispatch(Event.AUTO_TRIGGER_CLAMP)
    assert sm.state == State.CLAMP_PRESSED

    sm.dispatch(Event.CLAMP_PRESSED_ACK)
    assert sm.state == State.WAIT_CLAMP_FORCE

    sm.dispatch(Event.CLAMP_FORCE_REACHED)
    assert sm.state == State.WAIT_B5

    sm.dispatch(Event.B5_RECEIVED)
    assert sm.state == State.TENSION_CHECK

    sm.dispatch(Event.B6_RECEIVED)
    assert sm.state == State.EVALUATE

    sm.dispatch(Event.EVALUATION_DONE)
    assert sm.state == State.UNCLAMP

    sm.dispatch(Event.UNCLAMP_DONE)
    assert sm.state == State.LOOP_BEGIN

    sm.dispatch(Event.AUTO_TRIGGER_CLAMP)
    sm.dispatch(Event.CLAMP_PRESSED_ACK)
    sm.dispatch(Event.CLAMP_FORCE_REACHED)
    sm.dispatch(Event.B5_RECEIVED)
    sm.dispatch(Event.B6_RECEIVED)
    sm.dispatch(Event.EVALUATION_DONE)
    sm.dispatch(Event.UNCLAMP_DONE)
    assert sm.state == State.DONE_B7

    sm.dispatch(Event.B7_RECEIVED)
    assert sm.state == State.IDLE


def test_manual_mode_waits_for_clamp_command():
    sm = StateMachine(loop_count=1, mode=RunMode.MANUAL)
    sm.dispatch(Event.START)
    sm.dispatch(Event.PARAMS_WRITTEN)
    assert sm.state == State.LOOP_BEGIN

    sm.dispatch(Event.AUTO_TRIGGER_CLAMP)
    assert sm.state == State.LOOP_BEGIN

    sm.dispatch(Event.MANUAL_CLAMP_REQUESTED)
    assert sm.state == State.CLAMP_PRESSED


def test_abort_from_any_state():
    sm = StateMachine(loop_count=10, mode=RunMode.AUTO)
    sm.dispatch(Event.START)
    sm.dispatch(Event.PARAMS_WRITTEN)
    sm.dispatch(Event.AUTO_TRIGGER_CLAMP)
    sm.dispatch(Event.CLAMP_PRESSED_ACK)
    sm.dispatch(Event.ABORT)
    assert sm.state == State.ABORTED


def test_reset_returns_to_idle():
    sm = StateMachine(loop_count=1, mode=RunMode.AUTO)
    sm.dispatch(Event.START)
    sm.dispatch(Event.ABORT)
    assert sm.state == State.ABORTED
    sm.dispatch(Event.RESET)
    assert sm.state == State.IDLE


def test_error_event_transitions_to_error():
    sm = StateMachine(loop_count=1, mode=RunMode.AUTO)
    sm.dispatch(Event.START)
    sm.dispatch(Event.ERROR)
    assert sm.state == State.ERROR
