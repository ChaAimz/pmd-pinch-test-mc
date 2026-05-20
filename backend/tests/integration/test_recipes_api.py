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


def test_create_list_get_update_delete_recipe(client):
    payload = {
        "name": "tape-test",
        "position_mm": 25.0,
        "speed_mms": 10.0,
        "clamp_threshold_n": 7.0,
        "loop_count": 5,
    }
    r = client.post("/api/recipes", json=payload)
    assert r.status_code == 201
    body = r.json()
    recipe_id = body["id"]

    r = client.get("/api/recipes")
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = client.get(f"/api/recipes/{recipe_id}")
    assert r.status_code == 200
    assert r.json()["name"] == "tape-test"

    r = client.put(f"/api/recipes/{recipe_id}", json={"loop_count": 10})
    assert r.status_code == 200
    assert r.json()["loop_count"] == 10

    r = client.delete(f"/api/recipes/{recipe_id}")
    assert r.status_code == 204

    r = client.get(f"/api/recipes/{recipe_id}")
    assert r.status_code == 404


def test_validation_errors(client):
    bad = {"name": "x", "position_mm": -1, "speed_mms": 5, "clamp_threshold_n": 5, "loop_count": 1}
    r = client.post("/api/recipes", json=bad)
    assert r.status_code == 422
