from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class SessionStartRequest(BaseModel):
    recipe_id: int
    operator: Optional[str] = None
    batch_id: Optional[str] = None
    shift: Optional[str] = None
    mode: Literal["manual", "auto"] = "auto"


class SessionStartResponse(BaseModel):
    run_id: int
