from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import deps
from app.schemas.system import ExportFileRequest, ExportFileResponse, RemovableDrivesResponse
from app.services import system_service

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/removable-drives", response_model=RemovableDrivesResponse)
def removable_drives() -> RemovableDrivesResponse:
    """Live readout only — the operator UI shows this as a status line, not a picker.

    export-file below re-resolves the target itself on every call; this
    endpoint never feeds a client-supplied drive back into that request.
    """
    excluded = deps.get_settings().export.excluded_drive_letters
    return RemovableDrivesResponse(drives=system_service.list_removable_drives(excluded))


@router.post("/export-file", response_model=ExportFileResponse)
def export_file(req: ExportFileRequest) -> ExportFileResponse:
    excluded = deps.get_settings().export.excluded_drive_letters
    try:
        dest_path, target = system_service.export_file(
            folder=req.folder,
            filename=req.filename,
            ext=req.ext,
            content=req.content,
            encoding=req.encoding,
            excluded_letters=excluded,
        )
    except system_service.SanitizationError as exc:
        raise HTTPException(400, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, f"Failed to write export file: {exc}") from exc

    system_service.reveal_in_explorer(dest_path)
    return ExportFileResponse(saved_path=str(dest_path), target=target)
