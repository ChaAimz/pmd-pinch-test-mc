from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AnnotationSchema(BaseModel):
    id: str
    cycleIndex: int  # 0-based cycle index
    yValue: float
    text: str
    color: str


class ComparisonBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    run_ids: List[int] = Field(default_factory=list)
    labels: Dict[str, str] = Field(default_factory=dict)  # keys are run-id strings (JSON object keys)
    annotations: List[AnnotationSchema] = Field(default_factory=list)
    # Opaque chart display settings (Y min/max, line width, symbol size, etc.).
    # Backend stores/returns it as-is; the shape is owned by the frontend.
    chart_config: Optional[Dict[str, Any]] = None


class ComparisonCreate(ComparisonBase):
    pass


class ComparisonUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None
    run_ids: Optional[List[int]] = None
    labels: Optional[Dict[str, str]] = None
    annotations: Optional[List[AnnotationSchema]] = None
    chart_config: Optional[Dict[str, Any]] = None


class ComparisonRead(ComparisonBase):
    id: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}
