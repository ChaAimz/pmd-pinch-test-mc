from pathlib import Path

import pytest

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
    # float32 storage means values come back with float32 precision.
    assert arr["force_n"] == pytest.approx([0.0, 1.5, 3.2], rel=1e-6)


def test_trim_active_drops_preroll_and_tail():
    # 3 pre-roll samples clamped to t_ms=0 (incl. a negative), then the real pull.
    t_ms = [0, 0, 0, 10, 20, 30, 40, 50]
    force = [-0.13, 0.02, 0.03, 0.20, 0.55, 0.40, 0.10, 0.01]
    # tension_end_ms known → keep samples with t_ms <= end (pre-roll still dropped).
    t, f = WaveformService.trim_active(t_ms, force, tension_end_ms=40)
    assert t == [10, 20, 30, 40]
    assert f == pytest.approx([0.20, 0.55, 0.40, 0.10])
    # No negative pre-roll survives.
    assert min(f) >= 0


def test_trim_active_tail_heuristic_without_tension_end():
    # No tension_end_ms → 5%-of-peak tail trim after dropping the t_ms=0 pre-roll.
    t_ms = [0, 0, 10, 20, 30, 40]
    force = [-0.10, 0.03, 0.50, 1.00, 0.40, 0.001]  # peak 1.0, threshold 0.05
    t, f = WaveformService.trim_active(t_ms, force, tension_end_ms=None)
    assert t == [10, 20, 30]           # trailing 0.001 (<0.05) dropped
    assert f == pytest.approx([0.50, 1.00, 0.40])


def test_trim_active_empty_and_all_zero():
    assert WaveformService.trim_active([], [], None) == ([], [])
    # All-zero timestamps (fully broken loop): keep as-is rather than blanking.
    t, f = WaveformService.trim_active([0, 0, 0], [0.1, 0.2, 0.3], tension_end_ms=None)
    assert t == [0, 0, 0]


def test_loop_summary(tmp_path: Path):
    svc = WaveformService(base_dir=tmp_path)
    samples = [
        WaveformSample(t_ms=i * 10, force_n=float(i % 5))
        for i in range(50)
    ]
    summary = svc.summarize(samples)
    assert summary.peak_force_n == 4.0
    assert summary.avg_force_n > 0
    # hold_time_ms = B5→B6 measured duration = last sample t_ms
    assert summary.hold_time_ms == samples[-1].t_ms
