from pathlib import Path

from app.services.waveform import WaveformService, WaveformSample


def test_write_and_read_waveform(tmp_path: Path):
    svc = WaveformService(base_dir=tmp_path)
    samples = [
        WaveformSample(t_ms=0, force_n=0.0),
        WaveformSample(t_ms=10, force_n=1.5),
        WaveformSample(t_ms=20, force_n=3.2),
    ]
    path = svc.write_loop(run_id=42, loop_index=1, samples=samples)
    assert path.exists()
    rel = svc.relative_path(path)
    assert rel.endswith("loop_001.parquet")

    arr = svc.read_loop(run_id=42, loop_index=1)
    assert arr["t_ms"] == [0, 10, 20]
    assert arr["force_n"] == [0.0, 1.5, 3.2]


def test_loop_summary(tmp_path: Path):
    svc = WaveformService(base_dir=tmp_path)
    samples = [
        WaveformSample(t_ms=i * 10, force_n=float(i % 5))
        for i in range(50)
    ]
    summary = svc.summarize(samples, min_force_n=2.0)
    assert summary.peak_force_n == 4.0
    assert summary.avg_force_n > 0
    assert summary.hold_time_ms >= 0
