from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.db.engine import get_session
from app.schemas.comparison import ComparisonCreate, ComparisonRead, ComparisonUpdate
from app.services.comparison_service import ComparisonService

router = APIRouter(prefix="/api/comparisons", tags=["comparisons"])


@router.get("", response_model=List[ComparisonRead])
def list_comparisons(session: Session = Depends(get_session)):
    return ComparisonService(session).list_all()


@router.post("", response_model=ComparisonRead, status_code=status.HTTP_201_CREATED)
def create_comparison(data: ComparisonCreate, session: Session = Depends(get_session)):
    return ComparisonService(session).create(data)


@router.get("/{comparison_id}", response_model=ComparisonRead)
def get_comparison(comparison_id: int, session: Session = Depends(get_session)):
    r = ComparisonService(session).get(comparison_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Comparison not found")
    return r


@router.put("/{comparison_id}", response_model=ComparisonRead)
def update_comparison(
    comparison_id: int, data: ComparisonUpdate, session: Session = Depends(get_session)
):
    try:
        return ComparisonService(session).update(comparison_id, data)
    except KeyError:
        raise HTTPException(status_code=404, detail="Comparison not found")


@router.delete("/{comparison_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comparison(comparison_id: int, session: Session = Depends(get_session)):
    ComparisonService(session).delete(comparison_id)
    return None
