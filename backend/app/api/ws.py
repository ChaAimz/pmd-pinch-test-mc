from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket

from app import deps

router = APIRouter()

# Bits whose initial state must be sent to the client on connect.
# These are PLC→Web indicator bits that the UI uses for the toolbar
# and the Start-button gate (MR303 = Machine Ready).  Without an
# initial snapshot the frontend only learns about them on the first
# *change*, so a bit that starts ON and never changes is never seen.
# MR814 (Loops Complete ack) is included so a kiosk reload while the
# ack is still pending re-raises the Complete-Loops confirm dialog.
_SNAPSHOT_BIT_ADDRS = [300, 301, 302, 303, 814]


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    hub = deps.get_ws_hub()
    mgr = deps.get_manager()
    q = hub.register()

    # Send initial PLC bit snapshot so the UI doesn't miss bits that
    # are already ON when the browser connects (e.g. MR303 Machine Ready
    # in mock mode where no change-event is ever fired).
    if mgr.plc is not None and mgr.plc.is_connected:
        loop = asyncio.get_running_loop()
        for addr in _SNAPSHOT_BIT_ADDRS:
            try:
                value = await loop.run_in_executor(None, mgr.plc.read_bit, addr)
                await websocket.send_json({"type": "plc_bit", "addr": addr, "value": value})
            except Exception:
                pass  # addr not in device_map (real PLC) — skip silently

    # MR815 (Imada Tension Limit Reached) is manual-dismiss-only and can stay
    # latched a long time, unlike the transient MR810 alarm — re-raise the
    # dialog on reload/reconnect while unacknowledged.
    if mgr.is_imada_tension_alarm_active():
        try:
            await websocket.send_json({
                "type": "imada_tension_alarm",
                "active": True,
                "message": "Imada Tension Limit Reached",
                "limit_n": mgr.get_imada_tension_limit(),
            })
        except Exception:
            pass

    async def _sender():
        while True:
            msg = await q.get()
            await websocket.send_json(msg)

    async def _receiver():
        while True:
            try:
                data = await websocket.receive_json()
                if isinstance(data, dict) and data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except Exception:
                return

    sender = asyncio.create_task(_sender())
    receiver = asyncio.create_task(_receiver())
    try:
        await asyncio.wait([sender, receiver], return_when=asyncio.FIRST_COMPLETED)
    finally:
        sender.cancel()
        receiver.cancel()
        await asyncio.gather(sender, receiver, return_exceptions=True)
        hub.unregister(q)
