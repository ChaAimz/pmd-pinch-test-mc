from __future__ import annotations

import csv
import io
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import delete
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


@router.delete("/{run_id}", status_code=204)
def delete_run(run_id: int, session: Session = Depends(get_session)):
    runner = deps.get_runner()
    if runner is not None and runner.is_running and runner._run_id == run_id:
        raise HTTPException(409, "Cannot delete a run that is currently in progress")
    run = session.get(TestRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    waveform_dir = run.waveform_dir  # capture before delete
    session.exec(delete(TestLoop).where(TestLoop.run_id == run_id))
    session.delete(run)
    session.commit()
    if waveform_dir:
        shutil.rmtree(waveform_dir, ignore_errors=True)
    return Response(status_code=204)


@router.get("/{run_id}/summary.csv")
def export_summary_csv(run_id: int, session: Session = Depends(get_session)):
    """Export per-loop summary metrics: peak/avg force, hold time, judgment."""
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
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="run_{run_id}_summary.csv"'})


@router.get("/{run_id}/export.csv")
def export_csv(run_id: int, trimmed: bool = True, session: Session = Depends(get_session)):
    """Export the Imada waveform samples — the data plotted in the chart.

    One row per sample across every loop: loop_index, time_s, force_n.

    By default (``trimmed=True``) each loop is trimmed to the charted active tension
    window — the t_ms=0 pre-roll baseline is dropped and the decaying tail removed —
    and time is re-zeroed per loop, so the CSV matches the on-screen chart exactly.
    Pass ``?trimmed=false`` for the full untrimmed capture.
    """
    run = session.get(TestRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    loops = list(session.exec(select(TestLoop).where(TestLoop.run_id == run_id).order_by(TestLoop.loop_index)).all())
    wf = deps.get_waveform()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["loop_index", "time_s", "force_n", "CoF", "Clamp Average"])
    for l in loops:
        try:
            data = wf.read_loop(run_id, l.loop_index)
        except FileNotFoundError:
            continue
        t_list = data["t_ms"]
        f_list = data["force_n"]
        if trimmed:
            t_list, f_list = wf.trim_active(t_list, f_list, l.tension_end_ms)
            t0 = t_list[0] if t_list else 0
        else:
            t0 = 0
        avg_clamp = l.avg_clamp_n
        for t_ms, force_n in zip(t_list, f_list):
            cof = round(force_n / avg_clamp, 6) if avg_clamp else ""
            writer.writerow([l.loop_index, round((t_ms - t0) / 1000, 4), round(force_n, 4), cof, round(avg_clamp, 4) if avg_clamp is not None else ""])
    buffer.seek(0)
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="run_{run_id}_imada.csv"'})
