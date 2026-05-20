from __future__ import annotations

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app import deps
from app.db.engine import get_session
from app.db.models import TestLoop, TestRun
from app.schemas.run import TestLoopRead, TestRunRead

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.get("", response_model=list[TestRunRead])
def list_runs(
    session: Session = Depends(get_session),
    status: Optional[str] = None,
    recipe_id: Optional[int] = None,
    operator: Optional[str] = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
):
    stmt = select(TestRun).order_by(TestRun.started_at.desc())
    if status:
        stmt = stmt.where(TestRun.status == status)
    if recipe_id:
        stmt = stmt.where(TestRun.recipe_id == recipe_id)
    if operator:
        stmt = stmt.where(TestRun.operator == operator)
    stmt = stmt.offset(offset).limit(limit)
    runs = list(session.exec(stmt).all())
    return [
        TestRunRead.model_validate({**r.model_dump(), "loops": []})
        for r in runs
    ]


@router.get("/{run_id}", response_model=TestRunRead)
def get_run(run_id: int, session: Session = Depends(get_session)):
    run = session.get(TestRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    loops = list(session.exec(select(TestLoop).where(TestLoop.run_id == run_id).order_by(TestLoop.loop_index)).all())
    loop_dicts = [l.model_dump() for l in loops]
    return TestRunRead.model_validate({**run.model_dump(), "loops": loop_dicts})


@router.get("/{run_id}/loops/{idx}/waveform")
def get_waveform(run_id: int, idx: int):
    wf = deps.get_waveform()
    try:
        return wf.read_loop(run_id, idx)
    except FileNotFoundError:
        raise HTTPException(404, "Waveform not found")


@router.get("/{run_id}/export.csv")
def export_csv(run_id: int, session: Session = Depends(get_session)):
    run = session.get(TestRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    loops = list(session.exec(select(TestLoop).where(TestLoop.run_id == run_id).order_by(TestLoop.loop_index)).all())
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["run_id", "loop_index", "started_at", "finished_at", "peak_force_n", "avg_force_n", "hold_time_ms", "judgment"])
    for l in loops:
        writer.writerow([run.id, l.loop_index, l.started_at, l.finished_at or "", l.peak_force_n or "", l.avg_force_n or "", l.hold_time_ms or "", l.judgment or ""])
    buffer.seek(0)
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="run_{run_id}.csv"'})
