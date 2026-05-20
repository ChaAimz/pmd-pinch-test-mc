import asyncio

import pytest

from app.services.event_bus import EventBus


@pytest.mark.asyncio
async def test_publish_to_subscribers():
    bus = EventBus()
    received = []
    q = await bus.subscribe()

    async def consume():
        msg = await q.get()
        received.append(msg)

    task = asyncio.create_task(consume())
    await bus.publish({"type": "hello", "n": 1})
    await asyncio.wait_for(task, timeout=1)
    assert received == [{"type": "hello", "n": 1}]


@pytest.mark.asyncio
async def test_unsubscribe_after_drop():
    bus = EventBus()
    q = await bus.subscribe()
    await bus.unsubscribe(q)
    await bus.publish({"type": "x"})
    assert q.empty()
