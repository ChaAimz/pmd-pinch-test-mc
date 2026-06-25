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

    def _enqueue_to_clients(self, msg: dict) -> None:
        """Push *msg* into every connected client queue. Must run on the event-loop thread."""
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

    def broadcast_threadsafe(self, msg: dict, loop: asyncio.AbstractEventLoop) -> None:
        """Schedule *msg* delivery to all WS clients from any thread.

        Caller supplies the running event loop (the manager stores it after start()).
        """
        loop.call_soon_threadsafe(self._enqueue_to_clients, msg)

    async def pump(self) -> None:
        bus_q = await self.bus.subscribe()
        try:
            while True:
                msg = await bus_q.get()
                self._enqueue_to_clients(msg)
        finally:
            await self.bus.unsubscribe(bus_q)
