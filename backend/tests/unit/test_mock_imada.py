import time

from app.hardware.mock.mock_imada import MockImada


def test_mock_imada_streams_at_target_rate():
    imada = MockImada(rate_hz=200, peak_n=8.0)
    imada.connect()
    samples = []
    imada.subscribe(lambda r: samples.append(r))
    imada.start_stream()
    time.sleep(0.3)
    imada.stop_stream()
    imada.disconnect()
    assert len(samples) >= 30
    forces = [s.force_n for s in samples]
    assert max(forces) <= 8.5
    assert min(forces) >= -0.5
