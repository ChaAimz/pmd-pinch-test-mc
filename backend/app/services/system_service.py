from __future__ import annotations

import base64
import binascii
import ctypes
import re
import subprocess
from pathlib import Path
from typing import Iterable, Literal

from loguru import logger

from app.schemas.system import RemovableDrive

# Conservative allowlist for a single path component (folder or filename,
# no extension). Anything outside this set — path separators, drive-letter
# colons, wildcards, etc. — is stripped rather than rejected outright.
_SANITIZE_RE = re.compile(r"[^A-Za-z0-9_\- ]+")

DRIVE_REMOVABLE = 2


class SanitizationError(ValueError):
    """Raised when a folder or filename sanitizes down to an empty string."""


def sanitize_component(raw: str) -> str:
    """Reduce an operator-typed string to a safe single path component.

    Strips everything outside [A-Za-z0-9_- ], then trims leading/trailing
    spaces and dots (Windows disallows trailing dots/spaces in names).
    Returns "" if nothing usable remains — callers must treat that as a
    400, never silently fall back to a default name.
    """
    if not raw:
        return ""
    cleaned = _SANITIZE_RE.sub("", raw)
    return cleaned.strip(" .")


def list_removable_drives(excluded_letters: Iterable[str] = ()) -> list[RemovableDrive]:
    """Enumerate currently-attached Windows removable (USB) drives.

    Freshly queries the OS on every call — no caching — so callers always
    see the live set. Returns [] on non-Windows platforms (e.g. running the
    test suite under coverage on a non-Windows CI box) or when no removable
    drive is attached.

    `excluded_letters` filters out specific drive letters (e.g. {"D"}) even
    when Windows reports them as DRIVE_REMOVABLE — GetDriveTypeW makes no
    distinction between a genuine USB thumb drive and a permanently-attached
    USB hard disk/enclosure that happens to report the same way, so a
    per-machine override (config.yaml: export.excluded_drive_letters) is the
    only reliable fix for a false positive like that.
    """
    excluded = {letter.strip().rstrip(":\\").upper() for letter in excluded_letters}
    drives: list[RemovableDrive] = []
    windll = getattr(ctypes, "windll", None)
    if windll is None:
        return drives
    kernel32 = windll.kernel32

    bitmask = kernel32.GetLogicalDrives()
    for i in range(26):
        if not (bitmask & (1 << i)):
            continue
        letter = chr(ord("A") + i)
        if letter in excluded:
            continue
        root = f"{letter}:\\"
        drive_type = kernel32.GetDriveTypeW(ctypes.c_wchar_p(root))
        if drive_type != DRIVE_REMOVABLE:
            continue

        free_bytes = ctypes.c_ulonglong(0)
        total_bytes = ctypes.c_ulonglong(0)
        ok = kernel32.GetDiskFreeSpaceExW(
            ctypes.c_wchar_p(root),
            ctypes.byref(free_bytes),
            ctypes.byref(total_bytes),
            None,
        )
        if not ok:
            # Drive letter present but not ready (e.g. empty card reader slot).
            continue

        label_buf = ctypes.create_unicode_buffer(261)
        kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p(root),
            label_buf,
            ctypes.sizeof(label_buf),
            None,
            None,
            None,
            None,
            0,
        )

        drives.append(
            RemovableDrive(
                path=root,
                label=label_buf.value or None,
                free_bytes=free_bytes.value,
                total_bytes=total_bytes.value,
            )
        )
    return drives


def resolve_export_target(
    excluded_letters: Iterable[str] = (),
) -> tuple[Path, Literal["flash_drive", "desktop"]]:
    """Pick the export destination root, evaluated fresh every call.

    Flash drive wins if one is attached (first entry from
    list_removable_drives()); otherwise falls back to the current user's
    Desktop. No client input, no caching — this is the whole point of the
    "fully automatic destination" contract.
    """
    drives = list_removable_drives(excluded_letters)
    if drives:
        return Path(drives[0].path), "flash_drive"
    return Path.home() / "Desktop", "desktop"


def reveal_in_explorer(path: Path) -> None:
    """Best-effort: open Explorer with `path` selected, so the operator can see
    what actually landed next to it. Never raises — a failure here (no desktop
    session, headless service account, etc.) must not fail the export itself.
    """
    try:
        subprocess.Popen(["explorer", f"/select,{path}"])
    except OSError as exc:
        logger.warning("reveal_in_explorer({}) failed: {}", path, exc)


def export_file(
    *,
    folder: str,
    filename: str,
    ext: str,
    content: str,
    encoding: str,
    excluded_letters: Iterable[str] = (),
) -> tuple[Path, Literal["flash_drive", "desktop"]]:
    """Sanitize, resolve target, and write the export file.

    Raises SanitizationError (→ 400 at the API layer) if folder/filename
    sanitize to empty. Raises OSError (→ 500 at the API layer) on any
    filesystem failure (drive unplugged mid-write, permission denied, etc).
    """
    safe_folder = sanitize_component(folder)
    safe_filename = sanitize_component(filename)
    if not safe_folder or not safe_filename:
        raise SanitizationError("folder and filename must contain at least one valid character")

    if encoding == "base64":
        try:
            payload: bytes | str = base64.b64decode(content, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise SanitizationError(f"content is not valid base64: {exc}") from exc
    else:
        payload = content

    target_root, target = resolve_export_target(excluded_letters)
    dest_dir = target_root / safe_folder
    dest_dir.mkdir(exist_ok=True)
    dest_path = dest_dir / f"{safe_filename}.{ext}"

    if encoding == "base64":
        dest_path.write_bytes(payload)
    else:
        dest_path.write_text(payload, encoding="utf-8")

    return dest_path, target
