import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.db.models import Recipe, TestLoop, TestRun
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        with Session(e) as s:
            r = Recipe(name="r", position_mm=1, speed_mms=1, clamp_threshold_n=1, loop_count=1,
                       created_at="t", updated_at="t")
            s.add(r); s.commit(); s.refresh(r)
            run = TestRun(recipe_id=r.id, started_at="t", status="pass", loops_completed=1)
            s.add(run); s.commit(); s.refresh(run)
            loop = TestLoop(run_id=run.id, loop_index=1, started_at="t", peak_force_n=8.0, judgment="pass")
            s.add(loop); s.commit()
        yield c


def test_list_and_get_run(client):
    r = client.get("/api/runs")
    assert r.status_code == 200
    runs = r.json()
    assert len(runs) == 1
    rid = runs[0]["id"]

    r = client.get(f"/api/runs/{rid}")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "pass"


def test_export_csv(client):
    rid = client.get("/api/runs").json()[0]["id"]
    r = client.get(f"/api/runs/{rid}/export.csv")
    assert r.status_code == 200
    assert "loop_index" in r.text
