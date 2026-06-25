"""Integration tests for GET/PUT /api/settings.

Covers:
  (a) Fresh DB returns empty dict (no row yet).
  (b) PUT followed by GET round-trips the full camelCase settings object.
  (c) Keys are returned camelCase unchanged — no snake_case conversion.
"""
import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.main import build_app

FULL_SETTINGS = {
    "theme": "dark",
    "accentHue": 180,
    "sidebarCollapsed": False,
    "esp32Unit": "N",
    "showClampCard": True,
    "chartMode": "gated",
    "minimalView": True,
    "language": "th",
    "clampOffsetGf": 42.5,
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        yield c


# (a) Fresh DB → empty dict
def test_get_settings_fresh_db(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    assert r.json() == {}


# (b) PUT → GET round-trip
def test_put_then_get_round_trips(client):
    put_r = client.put("/api/settings", json=FULL_SETTINGS)
    assert put_r.status_code == 200
    assert put_r.json() == {"ok": True}

    get_r = client.get("/api/settings")
    assert get_r.status_code == 200
    got = get_r.json()
    assert got == FULL_SETTINGS


# (b continued) Second PUT overwrites the row (upsert)
def test_put_upsert_overwrites(client):
    client.put("/api/settings", json=FULL_SETTINGS)

    updated = {**FULL_SETTINGS, "theme": "light", "accentHue": 300}
    client.put("/api/settings", json=updated)

    got = client.get("/api/settings").json()
    assert got["theme"] == "light"
    assert got["accentHue"] == 300
    # other fields untouched
    assert got["language"] == "th"


# (c) Keys are camelCase, not snake_case
def test_keys_are_camel_case(client):
    client.put("/api/settings", json=FULL_SETTINGS)
    got = client.get("/api/settings").json()

    # Spot-check specific camelCase keys that would be snake_case if mis-converted.
    assert "accentHue" in got
    assert "sidebarCollapsed" in got
    assert "esp32Unit" in got
    assert "showClampCard" in got
    assert "chartMode" in got
    assert "minimalView" in got
    assert "clampOffsetGf" in got

    # None of these should appear as snake_case variants.
    assert "accent_hue" not in got
    assert "sidebar_collapsed" not in got
    assert "esp32_unit" not in got
    assert "show_clamp_card" not in got
    assert "chart_mode" not in got
    assert "minimal_view" not in got
    assert "clamp_offset_gf" not in got
