from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

import pyarrow as pa
import pyarrow.parquet as pq


@dataclass(frozen=True)
class WaveformSample:
    t_ms: int
    force_n: float


@dataclass(frozen=True)
class LoopSummary:
    peak_force_n: float
    avg_force_n: float
    hold_time_ms: int


class WaveformService:
    def __init__(self, base_dir: Path | str):
        self.base_dir = Path(base_dir)
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

    def relative_path(self, abs_path: Path) -> str:
        return str(abs_path.relative_to(self.base_dir.parent)) if self.base_dir.parent in abs_path.parents else str(abs_path)

    def summarize(self, samples: Sequence[WaveformSample], min_force_n: Optional[float]) -> LoopSummary:
        if not samples:
            return LoopSummary(peak_force_n=0.0, avg_force_n=0.0, hold_time_ms=0)
        forces = [s.force_n for s in samples]
        peak = max(forces)
        avg = sum(forces) / len(forces)
        hold_ms = 0
        if min_force_n is not None:
            above = [s for s in samples if s.force_n >= min_force_n]
            if above:
                hold_ms = above[-1].t_ms - above[0].t_ms
        return LoopSummary(peak_force_n=peak, avg_force_n=avg, hold_time_ms=hold_ms)
