import time

from app.hardware.mock.mock_plc import MockPlc, MockPlcScript


def test_mock_plc_word_and_bit():
    plc = MockPlc()
    plc.connect()
    plc.write_word(100, 2500)
    assert plc.read_word(100) == 2500
    plc.set_bit(3, True)
    assert plc.read_bit(3) is True
    plc.disconnect()


def test_mock_plc_script_emits_bits_in_order():
    script = MockPlcScript(
        after_b3_to_b5_ms=10,
        after_b5_to_b6_ms=20,
        after_b6_to_b7_ms=10,
    )
    plc = MockPlc(script=script)
    plc.connect()
    events = []
    plc.subscribe(lambda evt: events.append(evt))
    plc.set_bit(3, True)
    time.sleep(0.2)
    bits = [(e.addr, e.value) for e in events if e.kind == "bit"]
    assert (5, True) in bits
    assert (6, True) in bits
    assert (7, True) in bits
