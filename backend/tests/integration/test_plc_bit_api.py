"""Integration tests for POST /api/hardware/plc/bit."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.main import build_app


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


# ---------------------------------------------------------------------------
# Happy-path — one-shot write
# ---------------------------------------------------------------------------

def test_set_bit_oneshot(client):
    """Set MR800 (Start) high; PLC should accept it and return ok=True."""
    r = client.post("/api/hardware/plc/bit", json={"addr": 800, "value": True})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["addr"] == 800
    assert body["value"] is True


def test_set_bit_mr802_high(client):
    """Set MR802 (Reset) high without pulse."""
    r = client.post("/api/hardware/plc/bit", json={"addr": 802, "value": True})
    assert r.status_code == 200
    assert r.json()["addr"] == 802


# ---------------------------------------------------------------------------
# Pulse write — MR802 reset (the main operator use-case)
# ---------------------------------------------------------------------------

def test_set_bit_pulse(client):
    """Pulse MR802 for 50 ms — endpoint must complete and return ok=True."""
    r = client.post(
        "/api/hardware/plc/bit",
        json={"addr": 802, "value": True, "pulse_ms": 50},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["addr"] == 802
    assert body["value"] is True
    # After pulse the mock bit should be back to False
    from app import deps
    mgr = deps.get_manager()
    assert mgr.plc.read_bit(802) is False


# ---------------------------------------------------------------------------
# Validation — read-only bits must be rejected
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("addr", [805, 806, 807])
def test_set_bit_readonly_rejected(client, addr):
    """MR805/MR806/MR807 are PLC→Web status bits; writing must return 422."""
    r = client.post("/api/hardware/plc/bit", json={"addr": addr, "value": True})
    assert r.status_code == 422


def test_set_bit_estop_readonly(client):
    """MR3 (hardware E-Stop) is PLC→Web; writing must return 422."""
    r = client.post("/api/hardware/plc/bit", json={"addr": 3, "value": True})
    assert r.status_code == 422


def test_set_bit_addr_unknown(client):
    """A completely unknown MR address must return 422."""
    r = client.post("/api/hardware/plc/bit", json={"addr": 999, "value": True})
    assert r.status_code == 422


def test_set_bit_addr_negative(client):
    r = client.post("/api/hardware/plc/bit", json={"addr": -1, "value": True})
    assert r.status_code == 422
