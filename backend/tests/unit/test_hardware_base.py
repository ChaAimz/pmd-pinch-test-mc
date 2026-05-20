import time

from app.hardware.base import ImadaReading, Esp32Reading, PlcEvent


def test_imada_reading_dataclass():
    r = ImadaReading(timestamp_ns=time.monotonic_ns(), force_n=1.23)
    assert r.force_n == 1.23


def test_esp32_reading_dataclass():
    r = Esp32Reading(timestamp_ns=time.monotonic_ns(), force_n=4.5, raw=1234)
    assert r.raw == 1234


def test_plc_event_bit_edge():
    e = PlcEvent.bit(addr=5, value=True)
    assert e.kind == "bit"
    assert e.addr == 5
    assert e.value is True
