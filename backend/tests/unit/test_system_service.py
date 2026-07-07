"""Unit tests for app.services.system_service.

Covers:
  - sanitize_component: allowlist stripping, path-separator/drive-colon
    removal, trailing dot/space trim, empty-result cases.
  - resolve_export_target: flash-drive-first, Desktop fallback — always
    re-evaluated (monkeypatch list_removable_drives per test, no caching).
  - export_file: sanitization errors, utf8/base64 writes, target routing.
"""

from __future__ import annotations

import base64
import ctypes
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.schemas.system import RemovableDrive
from app.services import system_service

DRIVE_REMOVABLE = 2
DRIVE_FIXED = 3


def _fake_windll(drive_types: dict[str, int]):
    """Minimal stand-in for ctypes.windll.kernel32 covering just the calls
    list_removable_drives() makes, so the exclusion filter can be tested
    without real hardware or a real Windows drive layout."""

    def get_logical_drives():
        mask = 0
        for letter in drive_types:
            mask |= 1 << (ord(letter) - ord("A"))
        return mask

    def get_drive_type_w(root):
        return drive_types.get(root.value[0], 0)

    def get_disk_free_space_ex_w(root, free_ref, total_ref, _none):
        ctypes.cast(free_ref, ctypes.POINTER(ctypes.c_ulonglong))[0] = 111
        ctypes.cast(total_ref, ctypes.POINTER(ctypes.c_ulonglong))[0] = 222
        return 1

    def get_volume_information_w(root, buf, *_rest):
        buf.value = f"VOL_{root.value[0]}"
        return 1

    kernel32 = SimpleNamespace(
        GetLogicalDrives=get_logical_drives,
        GetDriveTypeW=get_drive_type_w,
        GetDiskFreeSpaceExW=get_disk_free_space_ex_w,
        GetVolumeInformationW=get_volume_information_w,
    )
    return SimpleNamespace(kernel32=kernel32)


class TestListRemovableDrivesExclusion:
    """D: on the developer's own machine turned out to be a permanently
    attached data drive that Windows still reports as DRIVE_REMOVABLE —
    excluded_drive_letters exists specifically to override that false
    positive per-machine (config.yaml: export.excluded_drive_letters)."""

    def test_excluded_letter_is_filtered_out(self, monkeypatch):
        monkeypatch.setattr(
            ctypes, "windll", _fake_windll({"C": DRIVE_FIXED, "D": DRIVE_REMOVABLE, "E": DRIVE_REMOVABLE})
        )
        drives = system_service.list_removable_drives(excluded_letters=["D"])
        assert [d.path for d in drives] == ["E:\\"]

    def test_excluded_letters_accept_various_formats(self, monkeypatch):
        monkeypatch.setattr(ctypes, "windll", _fake_windll({"D": DRIVE_REMOVABLE}))
        for variant in ("D", "d", "D:", "D:\\"):
            assert system_service.list_removable_drives(excluded_letters=[variant]) == []

    def test_no_exclusions_by_default(self, monkeypatch):
        monkeypatch.setattr(ctypes, "windll", _fake_windll({"E": DRIVE_REMOVABLE}))
        drives = system_service.list_removable_drives()
        assert [d.path for d in drives] == ["E:\\"]


class TestSanitizeComponent:
    def test_strips_path_separators(self):
        assert system_service.sanitize_component("../../etc/passwd") == "etcpasswd"

    def test_strips_drive_colon_and_backslashes(self):
        assert system_service.sanitize_component("C:\\Windows\\System32") == "CWindowsSystem32"

    def test_allows_spaces_dashes_underscores(self):
        assert system_service.sanitize_component("site report-1_final") == "site report-1_final"

    def test_trims_trailing_dots_and_spaces(self):
        assert system_service.sanitize_component("report. ") == "report"

    def test_empty_when_all_characters_unsafe(self):
        assert system_service.sanitize_component("///???***") == ""

    def test_empty_input_returns_empty(self):
        assert system_service.sanitize_component("") == ""


class TestResolveExportTarget:
    def test_flash_drive_used_when_list_removable_drives_returns_one(self, monkeypatch, tmp_path):
        fake_drive = tmp_path / "fake_flash"
        fake_drive.mkdir()
        monkeypatch.setattr(
            system_service,
            "list_removable_drives",
            lambda *_a, **_k: [
                RemovableDrive(path=str(fake_drive), label="KINGSTON", free_bytes=1, total_bytes=2)
            ],
        )
        root, target = system_service.resolve_export_target()
        assert root == fake_drive
        assert target == "flash_drive"

    def test_desktop_fallback_when_no_drives_present(self, monkeypatch, tmp_path):
        monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
        monkeypatch.setattr(Path, "home", lambda: tmp_path)
        root, target = system_service.resolve_export_target()
        assert root == tmp_path / "Desktop"
        assert target == "desktop"

    def test_reevaluated_every_call_not_cached(self, monkeypatch, tmp_path):
        """No stale client-side list: back-to-back calls reflect a drive
        appearing/disappearing between them."""
        fake_drive = tmp_path / "fake_flash"
        fake_drive.mkdir()
        state = {"drives": []}
        monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: state["drives"])
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        _, target_before = system_service.resolve_export_target()
        assert target_before == "desktop"

        state["drives"] = [
            RemovableDrive(path=str(fake_drive), label=None, free_bytes=1, total_bytes=2)
        ]
        _, target_after = system_service.resolve_export_target()
        assert target_after == "flash_drive"


class TestExportFile:
    def test_sanitization_error_when_folder_empties_out(self, monkeypatch, tmp_path):
        (tmp_path / "Desktop").mkdir()
        monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        with pytest.raises(system_service.SanitizationError):
            system_service.export_file(
                folder="///", filename="run1", ext="csv", content="a,b", encoding="utf8"
            )

    def test_sanitization_error_when_filename_empties_out(self, monkeypatch, tmp_path):
        (tmp_path / "Desktop").mkdir()
        monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        with pytest.raises(system_service.SanitizationError):
            system_service.export_file(
                folder="site_report", filename="***", ext="csv", content="a,b", encoding="utf8"
            )

    def test_writes_utf8_content_to_desktop_when_no_drives(self, monkeypatch, tmp_path):
        (tmp_path / "Desktop").mkdir()
        monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        dest, target = system_service.export_file(
            folder="site_report",
            filename="run194_hydrophilic",
            ext="csv",
            content="loop,peak\n1,8.2\n",
            encoding="utf8",
        )
        assert target == "desktop"
        assert dest == tmp_path / "Desktop" / "site_report" / "run194_hydrophilic.csv"
        assert dest.read_text(encoding="utf-8") == "loop,peak\n1,8.2\n"

    def test_writes_base64_content_to_flash_drive_when_present(self, monkeypatch, tmp_path):
        fake_drive = tmp_path / "E"
        fake_drive.mkdir()
        monkeypatch.setattr(
            system_service,
            "list_removable_drives",
            lambda *_a, **_k: [RemovableDrive(path=str(fake_drive), label=None, free_bytes=1, total_bytes=2)],
        )
        raw = b"\x89PNG\r\n\x1a\n"
        payload = base64.b64encode(raw).decode()

        dest, target = system_service.export_file(
            folder="site_report", filename="chart", ext="png", content=payload, encoding="base64"
        )
        assert target == "flash_drive"
        assert dest == fake_drive / "site_report" / "chart.png"
        assert dest.read_bytes() == raw

    def test_folder_created_under_target_root(self, monkeypatch, tmp_path):
        fake_drive = tmp_path / "E"
        fake_drive.mkdir()
        monkeypatch.setattr(
            system_service,
            "list_removable_drives",
            lambda *_a, **_k: [RemovableDrive(path=str(fake_drive), label=None, free_bytes=1, total_bytes=2)],
        )
        assert not (fake_drive / "site_report").exists()
        system_service.export_file(
            folder="site_report", filename="run1", ext="csv", content="x", encoding="utf8"
        )
        assert (fake_drive / "site_report").is_dir()
