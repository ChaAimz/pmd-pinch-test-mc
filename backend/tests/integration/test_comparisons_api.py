import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)
    monkeypatch.setattr(db_engine, "_engine", test_engine)
    app = build_app(test_mode=True)
    return TestClient(app)


_PAYLOAD = {
    "name": "CoF compare Q2",
    "description": "Batch A vs B",
    "run_ids": [1, 2],
    "labels": {"1": "Batch A", "2": "Batch B"},
    "annotations": [
        {"id": "ann-1", "cycleIndex": 0, "yValue": 4.5, "text": "peak", "color": "#ff0000"}
    ],
}


def test_create_list_get_update_delete_round_trip(client):
    # CREATE
    r = client.post("/api/comparisons", json=_PAYLOAD)
    assert r.status_code == 201
    body = r.json()
    cid = body["id"]
    assert body["name"] == "CoF compare Q2"
    assert body["run_ids"] == [1, 2]
    assert body["labels"]["1"] == "Batch A"
    assert len(body["annotations"]) == 1
    assert body["annotations"][0]["id"] == "ann-1"
    assert "created_at" in body
    assert "updated_at" in body

    # LIST
    r = client.get("/api/comparisons")
    assert r.status_code == 200
    lst = r.json()
    assert len(lst) == 1
    assert lst[0]["id"] == cid

    # GET by id
    r = client.get(f"/api/comparisons/{cid}")
    assert r.status_code == 200
    assert r.json()["description"] == "Batch A vs B"

    # UPDATE — partial (annotations only)
    patch = {
        "annotations": [
            {"id": "ann-2", "cycleIndex": 1, "yValue": 2.2, "text": "hold", "color": "#0000ff"}
        ]
    }
    r = client.put(f"/api/comparisons/{cid}", json=patch)
    assert r.status_code == 200
    updated = r.json()
    assert len(updated["annotations"]) == 1
    assert updated["annotations"][0]["id"] == "ann-2"
    # run_ids / labels must survive partial update
    assert updated["run_ids"] == [1, 2]
    assert updated["labels"]["2"] == "Batch B"

    # UPDATE — name
    r = client.put(f"/api/comparisons/{cid}", json={"name": "renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "renamed"

    # DELETE
    r = client.delete(f"/api/comparisons/{cid}")
    assert r.status_code == 204

    # GET after delete → 404
    r = client.get(f"/api/comparisons/{cid}")
    assert r.status_code == 404


def test_get_nonexistent_returns_404(client):
    r = client.get("/api/comparisons/9999")
    assert r.status_code == 404


def test_put_nonexistent_returns_404(client):
    r = client.put("/api/comparisons/9999", json={"name": "x"})
    assert r.status_code == 404


def test_validation_name_empty(client):
    bad = dict(_PAYLOAD, name="")
    r = client.post("/api/comparisons", json=bad)
    assert r.status_code == 422


def test_list_empty(client):
    r = client.get("/api/comparisons")
    assert r.status_code == 200
    assert r.json() == []


def test_create_minimal(client):
    r = client.post("/api/comparisons", json={"name": "minimal"})
    assert r.status_code == 201
    body = r.json()
    assert body["run_ids"] == []
    assert body["labels"] == {}
    assert body["annotations"] == []
