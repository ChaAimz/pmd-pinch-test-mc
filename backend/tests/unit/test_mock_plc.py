import time

from app.hardware.mock.mock_plc import MockPlc, MockPlcScript


def test_mock_plc_word_and_bit():
    plc = MockPlc()
    plc.connect()
    plc.write_word(100, 2500)
    assert plc.read_word(100) == 2500
    plc.set_bit(803, True)
    assert plc.read_bit(803) is True
    plc.disconnect()


def test_mock_plc_script_emits_bits_in_order():
    # The mock now models the PLC owning the clamp cycle: Start (MR800) makes it
    # press the clamp (MR803), Clamp Stop (MR804↑) runs the tension cycle, and
    # Unclamp (MR804↓) finishes the run (MR807) on the last loop.
    script = MockPlcScript(
        before_mr803_ms=10,
        after_mr803_to_mr805_ms=10,
        after_mr805_to_mr806_ms=20,
        after_mr806_to_mr807_ms=10,
    )
    plc = MockPlc(script=script)
    plc.connect()
    events = []
    plc.subscribe(lambda evt: events.append(evt))

    plc.write_word(0, 1)     # loop count = 1
    plc.set_bit(800, True)   # Start → PLC presses clamp (MR803)
    time.sleep(0.1)
    assert plc.read_bit(803) is True
    plc.set_bit(804, True)   # backend Clamp Stop → tension cycle (MR805, MR806)
    time.sleep(0.1)
    plc.set_bit(804, False)  # backend Unclamp → last loop → Finish All (MR807)
    time.sleep(0.1)

    bits = [(e.addr, e.value) for e in events if e.kind == "bit"]
    assert (803, True) in bits
    assert (805, True) in bits
    assert (806, True) in bits
    assert (807, True) in bits
