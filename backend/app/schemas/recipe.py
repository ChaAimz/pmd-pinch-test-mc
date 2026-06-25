from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, model_validator


class RecipeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    position_mm: float = Field(..., gt=0, le=190)
    speed_mms: float = Field(..., gt=0)
    clamp_threshold_n: float = Field(..., ge=0)
    loop_count: int = Field(..., ge=1)
    min_force_n: Optional[float] = Field(default=None, ge=0)
    max_force_n: Optional[float] = Field(default=None, ge=0)
    sampling_hz: int = Field(default=50, ge=1, le=1000)
    diameter_mm: float = Field(default=0.0, ge=0)
    prepare_timer_s: int = Field(default=0, ge=0, le=9999)

    @model_validator(mode="after")
    def check_min_max(self):
        if self.min_force_n is not None and self.max_force_n is not None:
            if self.min_force_n > self.max_force_n:
                raise ValueError("min_force_n must be <= max_force_n")
        return self


class RecipeCreate(RecipeBase):
    pass


class RecipeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    position_mm: Optional[float] = Field(default=None, gt=0, le=190)
    speed_mms: Optional[float] = Field(default=None, gt=0)
    clamp_threshold_n: Optional[float] = Field(default=None, gt=0)
    loop_count: Optional[int] = Field(default=None, ge=1)
    min_force_n: Optional[float] = Field(default=None, ge=0)
    max_force_n: Optional[float] = Field(default=None, ge=0)
    sampling_hz: Optional[int] = Field(default=None, ge=1, le=1000)
    diameter_mm: Optional[float] = Field(default=None, ge=0)
    prepare_timer_s: Optional[int] = Field(default=None, ge=0, le=9999)


class RecipeRead(RecipeBase):
    id: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}
