import time

from app.hardware.mock.mock_esp32 import MockEsp32


def test_mock_esp32_ramps_to_target():
    esp = MockEsp32(rate_hz=200, target_n=7.0, ramp_ms=300, slope=0.01, offset=0.0)
    esp.connect()
    samples = []
    esp.subscribe(lambda r: samples.append(r))
    esp.start_stream()
    time.sleep(0.5)
    esp.stop_stream()
    esp.disconnect()
    forces = [s.force_n for s in samples]
    assert forces[-1] >= 6.5
    assert all(f >= 0 for f in forces)
