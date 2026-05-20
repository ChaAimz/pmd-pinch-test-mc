from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app import deps
from app.db.engine import get_session
from app.schemas.session import SessionStartRequest, SessionStartResponse
from app.services.recipe_service import RecipeService
from app.services.state_machine import RunMode

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("/start", response_model=SessionStartResponse)
async def start_session(req: SessionStartRequest, session: Session = Depends(get_session)):
    runner = deps.get_runner()
    if runner.is_running:
        raise HTTPException(409, "Session already running")
    recipe = RecipeService(session).get(req.recipe_id)
    if recipe is None:
        raise HTTPException(404, "Recipe not found")
    run_id = await runner.start(
        recipe=recipe,
        operator=req.operator,
        batch_id=req.batch_id,
        shift=req.shift,
        mode=RunMode(req.mode),
    )
    return SessionStartResponse(run_id=run_id)


@router.post("/{run_id}/clamp")
async def clamp(run_id: int):
    runner = deps.get_runner()
    await runner.request_manual_clamp()
    return {"ok": True}


@router.post("/{run_id}/stop")
async def stop(run_id: int):
    runner = deps.get_runner()
    await runner.request_abort()
    return {"ok": True}


@router.post("/{run_id}/reset")
async def reset(run_id: int):
    runner = deps.get_runner()
    await runner.request_reset()
    return {"ok": True}
