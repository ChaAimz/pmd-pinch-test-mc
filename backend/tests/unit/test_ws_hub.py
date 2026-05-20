import asyncio

import pytest

from app.services.event_bus import EventBus
from app.services.ws_hub import WsHub


@pytest.mark.asyncio
async def test_hub_broadcasts_event_bus_messages():
    bus = EventBus()
    hub = WsHub(bus)

    received_a, received_b = [], []
    a, b = hub.register(), hub.register()

    async def consume(q, sink):
        for _ in range(2):
            sink.append(await q.get())

    task_a = asyncio.create_task(consume(a, received_a))
    task_b = asyncio.create_task(consume(b, received_b))

    pump_task = asyncio.create_task(hub.pump())
    await asyncio.sleep(0)  # yield so pump can subscribe before we publish
    await bus.publish({"type": "hello"})
    await bus.publish({"type": "world"})
    await asyncio.wait_for(asyncio.gather(task_a, task_b), timeout=1)
    pump_task.cancel()
    assert received_a == [{"type": "hello"}, {"type": "world"}]
    assert received_b == received_a
