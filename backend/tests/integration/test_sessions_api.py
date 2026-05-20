import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        yield c


def test_start_session_404_recipe(client):
    r = client.post("/api/sessions/start", json={"recipe_id": 999})
    assert r.status_code == 404


def test_start_and_stop_flow(client):
    payload = {
        "name": "s1",
        "position_mm": 10.0,
        "speed_mms": 5.0,
        "clamp_threshold_n": 5.0,
        "loop_count": 1,
        "min_force_n": 0.0,
        "max_force_n": 100.0,
        "hold_time_ms": 0,
    }
    rid = client.post("/api/recipes", json=payload).json()["id"]
    r = client.post("/api/sessions/start", json={"recipe_id": rid, "mode": "auto"})
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    r2 = client.post("/api/sessions/start", json={"recipe_id": rid, "mode": "auto"})
    assert r2.status_code == 409
    r3 = client.post(f"/api/sessions/{run_id}/stop")
    assert r3.status_code == 200
