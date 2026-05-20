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


def test_hardware_status(client):
    r = client.get("/api/hardware/status")
    assert r.status_code == 200
    body = r.json()
    assert body["plc"] is True
    assert body["imada"] is True
    assert body["esp32"] is True


def test_esp32_calibration_compute(client):
    r = client.post("/api/hardware/esp32/calibrate", json={
        "raw_at_zero": 0,
        "raw_at_known": 1000,
        "known_force_n": 10.0,
    })
    assert r.status_code == 200
    body = r.json()
    assert abs(body["slope"] - 0.01) < 1e-9
    assert abs(body["offset"]) < 1e-9


def test_config_get(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    assert "hardware" in r.json()
