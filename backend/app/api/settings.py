from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.db.engine import get_session
from app.db.models import AppSettings

router = APIRouter(prefix="/api/settings", tags=["settings"])

_SINGLETON_ID = 1


@router.get("")
def get_settings(session: Session = Depends(get_session)):
    row = session.get(AppSettings, _SINGLETON_ID)
    if row is None:
        return {}
    try:
        return json.loads(row.data)
    except json.JSONDecodeError:
        return {}


@router.put("")
def put_settings(body: dict, session: Session = Depends(get_session)):
    row = session.get(AppSettings, _SINGLETON_ID)
    if row is None:
        row = AppSettings(id=_SINGLETON_ID, data=json.dumps(body))
    else:
        row.data = json.dumps(body)
    session.add(row)
    session.commit()
    return {"ok": True}
