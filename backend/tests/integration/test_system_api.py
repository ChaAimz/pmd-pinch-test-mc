"""Integration tests for GET /api/system/removable-drives and
POST /api/system/export-file.

export-file is fully automatic: no client-supplied `drive` field. The
server resolves the target on every request — flash drive first
(list_removable_drives()[0]), Desktop otherwise — so there is no more
"unknown drive" 404 case; an unplugged/never-attached drive just falls
back to Desktop.
"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.main import build_app
from app.schemas.system import RemovableDrive
from app.services import system_service


@pytest.fixture(autouse=True)
def no_real_explorer_popup(monkeypatch):
    # export-file opens Explorer on the saved path on success — never let a
    # test run actually pop a window on the dev/CI machine.
    monkeypatch.setattr(system_service, "reveal_in_explorer", lambda path: None)


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        yield c


# --- GET /api/system/removable-drives (unchanged; still a live status readout) ---


def test_removable_drives_empty(client, monkeypatch):
    monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
    r = client.get("/api/system/removable-drives")
    assert r.status_code == 200
    assert r.json() == {"drives": []}


def test_removable_drives_reports_attached_drive(client, monkeypatch):
    monkeypatch.setattr(
        system_service,
        "list_removable_drives",
        lambda *_a, **_k: [RemovableDrive(path="E:\\", label="KINGSTON", free_bytes=100, total_bytes=200)],
    )
    r = client.get("/api/system/removable-drives")
    assert r.status_code == 200
    body = r.json()
    assert body["drives"][0]["path"] == "E:\\"
    assert body["drives"][0]["label"] == "KINGSTON"


# --- POST /api/system/export-file ---


def test_export_file_falls_back_to_desktop_when_no_drives_detected(client, monkeypatch, tmp_path):
    (tmp_path / "Desktop").mkdir()
    monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    r = client.post(
        "/api/system/export-file",
        json={
            "folder": "site_report",
            "filename": "run194_hydrophilic",
            "ext": "csv",
            "content": "loop,peak\n1,8.2\n",
            "encoding": "utf8",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["target"] == "desktop"
    expected = tmp_path / "Desktop" / "site_report" / "run194_hydrophilic.csv"
    assert body["saved_path"] == str(expected)
    assert expected.read_text(encoding="utf-8") == "loop,peak\n1,8.2\n"


def test_export_file_writes_to_flash_drive_when_present(client, monkeypatch, tmp_path):
    fake_drive = tmp_path / "E"
    fake_drive.mkdir()
    monkeypatch.setattr(
        system_service,
        "list_removable_drives",
        lambda *_a, **_k: [
            RemovableDrive(path=str(fake_drive), label="KINGSTON", free_bytes=1, total_bytes=2)
        ],
    )

    payload = base64.b64encode(b"\x89PNG\r\n\x1a\n").decode()
    r = client.post(
        "/api/system/export-file",
        json={
            "folder": "site_report",
            "filename": "chart",
            "ext": "png",
            "content": payload,
            "encoding": "base64",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["target"] == "flash_drive"
    expected = fake_drive / "site_report" / "chart.png"
    assert body["saved_path"] == str(expected)
    assert expected.read_bytes() == base64.b64decode(payload)


def test_export_file_400_when_folder_sanitizes_to_empty(client, monkeypatch, tmp_path):
    (tmp_path / "Desktop").mkdir()
    monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    r = client.post(
        "/api/system/export-file",
        json={
            "folder": "///",
            "filename": "run1",
            "ext": "csv",
            "content": "a",
            "encoding": "utf8",
        },
    )
    assert r.status_code == 400


def test_export_file_400_when_filename_sanitizes_to_empty(client, monkeypatch, tmp_path):
    (tmp_path / "Desktop").mkdir()
    monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    r = client.post(
        "/api/system/export-file",
        json={
            "folder": "site_report",
            "filename": "***",
            "ext": "csv",
            "content": "a",
            "encoding": "utf8",
        },
    )
    assert r.status_code == 400


def test_export_file_500_on_os_error(client, monkeypatch, tmp_path):
    # Desktop root itself doesn't exist and mkdir() has no parents=True,
    # so the write fails with a FileNotFoundError (an OSError subclass).
    monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nonexistent_profile")

    r = client.post(
        "/api/system/export-file",
        json={
            "folder": "site_report",
            "filename": "run1",
            "ext": "csv",
            "content": "a",
            "encoding": "utf8",
        },
    )
    assert r.status_code == 500


def test_export_file_request_no_longer_accepts_drive_field(client, monkeypatch, tmp_path):
    """A client-supplied `drive` is silently ignored — never fed into
    target resolution. Confirms the old explicit-drive contract is gone."""
    (tmp_path / "Desktop").mkdir()
    monkeypatch.setattr(system_service, "list_removable_drives", lambda *_a, **_k: [])
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    r = client.post(
        "/api/system/export-file",
        json={
            "drive": "Z:\\",
            "folder": "site_report",
            "filename": "run1",
            "ext": "csv",
            "content": "a",
            "encoding": "utf8",
        },
    )
    assert r.status_code == 200
    assert r.json()["target"] == "desktop"
