from __future__ import annotations

import asyncio
from typing import List

from app.services.event_bus import EventBus


class WsHub:
    def __init__(self, bus: EventBus):
        self.bus = bus
        self._clients: List[asyncio.Queue] = []

    def register(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._clients.append(q)
        return q

    def unregister(self, q: asyncio.Queue) -> None:
        if q in self._clients:
            self._clients.remove(q)

    async def pump(self) -> None:
        bus_q = await self.bus.subscribe()
        try:
            while True:
                msg = await bus_q.get()
                for client in list(self._clients):
                    try:
                        client.put_nowait(msg)
                    except asyncio.QueueFull:
                        try:
                            client.get_nowait()
                        except Exception:
                            pass
                        try:
                            client.put_nowait(msg)
                        except Exception:
                            pass
        finally:
            await self.bus.unsubscribe(bus_q)
