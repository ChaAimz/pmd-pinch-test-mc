from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class RemovableDrive(BaseModel):
    path: str = Field(..., description="Windows drive root incl. trailing backslash, e.g. 'E:\\\\'")
    label: Optional[str] = None
    free_bytes: int
    total_bytes: int


class RemovableDrivesResponse(BaseModel):
    drives: list[RemovableDrive]


class ExportFileRequest(BaseModel):
    folder: str = Field(..., description="Operator-typed folder name; sanitized server-side")
    filename: str = Field(
        ..., description="Operator-typed filename (no extension); sanitized server-side"
    )
    ext: Literal["csv", "png"]
    content: str = Field(
        ..., description="File payload — raw text for utf8, bare base64 for base64"
    )
    encoding: Literal["utf8", "base64"]


class ExportFileResponse(BaseModel):
    saved_path: str
    target: Literal["flash_drive", "desktop"]
