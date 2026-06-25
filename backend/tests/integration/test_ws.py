import concurrent.futures
import threading

import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

from app.db import engine as db_engine
from app.db.models import Recipe
from app.main import build_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    e = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(e)
    monkeypatch.setattr(db_engine, "_engine", e)
    app = build_app(test_mode=True, waveform_dir=tmp_path)
    with TestClient(app) as c:
        with Session(e) as s:
            r = Recipe(
                name="ws", position_mm=10, speed_mms=5, clamp_threshold_n=5, loop_count=1,
                min_force_n=0, max_force_n=100, sampling_hz=100,
                created_at="t", updated_at="t",
            )
            s.add(r); s.commit(); s.refresh(r)
        yield c


def test_ws_emits_state_changes_and_finished(client):
    """WebSocket must emit at least one state_change and a run_finished message."""
    seen_types: list[str] = []

    def collect_messages(ws, max_msgs: int = 500) -> None:
        """Collect up to max_msgs WS messages in a background thread.

        Skips imada_batch/esp32_batch — those are high-rate live-stream messages
        broadcast by HardwareManager and would otherwise drown out the state
        events this test cares about.
        """
        skip = {"imada_batch", "esp32_batch"}
        try:
            for _ in range(max_msgs):
                msg = ws.receive_json()
                t = msg.get("type", "")
                if t in skip:
                    continue
                seen_types.append(t)
                if t == "run_finished":
                    break
        except BaseException:
            # WS disconnect, close, or asyncio CancelledError on teardown — all expected.
            pass

    try:
        with client.websocket_connect("/ws") as ws:
            reader = threading.Thread(target=collect_messages, args=(ws,), daemon=True)
            reader.start()

            rid = client.get("/api/recipes").json()[0]["id"]
            run_resp = client.post("/api/sessions/start", json={"recipe_id": rid, "mode": "auto"})
            assert run_resp.status_code == 200, run_resp.text

            reader.join(timeout=30)
    except concurrent.futures.CancelledError:
        # Python 3.14 + starlette TestClient race: the asyncio portal future is
        # cancelled while the WS context manager tries to send its close frame.
        # The session has already completed at this point, so the assertions below
        # still validate the actual test behaviour.
        pass

    assert "state_change" in seen_types, f"seen_types={seen_types}"
    assert "run_finished" in seen_types, f"seen_types={seen_types}"
