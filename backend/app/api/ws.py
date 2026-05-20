from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import deps

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    hub = deps.get_ws_hub()
    q = hub.register()
    try:
        while True:
            msg = await q.get()
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        return
    finally:
        hub.unregister(q)
