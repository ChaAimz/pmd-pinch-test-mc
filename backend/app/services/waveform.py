from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import pyarrow as pa
import pyarrow.parquet as pq


@dataclass(frozen=True)
class WaveformSample:
    t_ms: int
    force_n: float


@dataclass(frozen=True)
class LoopSummary:
    peak_force_n: float
    min_force_n: float
    avg_force_n: float
    hold_time_ms: int


class WaveformService:
    def __init__(self, base_dir: Path | str):
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _run_dir(self, run_id: int) -> Path:
        p = self.base_dir / str(run_id)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _loop_path(self, run_id: int, loop_index: int) -> Path:
        return self._run_dir(run_id) / f"loop_{loop_index:03d}.parquet"

    def write_loop(self, run_id: int, loop_index: int, samples: Sequence[WaveformSample]) -> Path:
        path = self._loop_path(run_id, loop_index)
        table = pa.table({
            "t_ms": pa.array([s.t_ms for s in samples], type=pa.uint32()),
            "force_n": pa.array([s.force_n for s in samples], type=pa.float32()),
        })
        pq.write_table(table, path)
        return path

    def read_loop(self, run_id: int, loop_index: int) -> dict:
        table = pq.read_table(self._loop_path(run_id, loop_index))
        return {
            "t_ms": table.column("t_ms").to_pylist(),
            "force_n": table.column("force_n").to_pylist(),
        }

    @staticmethod
    def _active_end_idx(force_n: Sequence[float]) -> int:
        """End index (exclusive) of the active signal: last sample after the force
        peak still above 5% of peak (floor 10 mN). Trims the decaying tail.
        Mirrors frontend lib/waveform.ts activeEndIdx."""
        n = len(force_n)
        if n == 0:
            return 0
        peak = max(force_n)
        peak_idx = list(force_n).index(peak)
        threshold = max(0.01, peak * 0.05)
        for k in range(n - 1, peak_idx, -1):
            if force_n[k] >= threshold:
                return k + 1
        return n

    @staticmethod
    def trim_active(
        t_ms: Sequence[int],
        force_n: Sequence[float],
        tension_end_ms: int | None,
    ) -> tuple[list[int], list[float]]:
        """Trim a loop's raw samples to the charted active window so an exported
        CSV matches the on-screen chart.

        Mirrors the frontend (lib/waveform.ts): first drop the leading t_ms == 0
        pre-roll block (pre-tension baseline whose negative settling values pile onto
        t_ms = 0), then trim to the active tension window — by tension_end_ms when
        known, else the 5%-of-peak tail heuristic.
        """
        t = list(t_ms)
        f = list(force_n)
        n = len(t)
        if n == 0:
            return [], []
        # dropPreRoll: skip the leading run of t_ms == 0
        i = 0
        while i < n and t[i] == 0:
            i += 1
        if 0 < i < n:
            t, f = t[i:], f[i:]
        # active window
        if tension_end_ms is not None:
            kept = [(tt, ff) for tt, ff in zip(t, f) if tt <= tension_end_ms]
            t = [k[0] for k in kept]
            f = [k[1] for k in kept]
        else:
            end = WaveformService._active_end_idx(f)
            t, f = t[:end], f[:end]
        return t, f

    def relative_path(self, abs_path: Path) -> str:
        return str(abs_path.relative_to(self.base_dir.parent)) if self.base_dir.parent in abs_path.parents else str(abs_path)

    def summarize(self, samples: Sequence[WaveformSample]) -> LoopSummary:
        """Compute peak/avg/min force and approximate B5→B6 hold duration.

        hold_time_ms is the timestamp of the last collected Imada sample (relative
        to B5). It approximates the B5→B6 duration but may be slightly less than the
        exact B6 fire time because the collection loop checks for B6 *before* reading
        the next sample — the sample collected in the same iteration as B6 detection
        is NOT added to the buffer. For the exact B6 time use tension_end_ms (stored
        separately in the loop record from _b6_t_ms in test_runner.py).
        """
        if not samples:
            return LoopSummary(peak_force_n=0.0, min_force_n=0.0, avg_force_n=0.0, hold_time_ms=0)
        forces = [s.force_n for s in samples]
        peak = max(forces)
        minimum = min(forces)
        avg = sum(forces) / len(forces)
        hold_ms = samples[-1].t_ms  # last sample timestamp ≈ B6 time (see docstring)
        return LoopSummary(peak_force_n=peak, min_force_n=minimum, avg_force_n=avg, hold_time_ms=hold_ms)
