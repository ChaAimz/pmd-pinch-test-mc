"""
Sanity test for RealPlc (bridge-based, KVComPlus USB).

Run with hardware connected, from backend/ directory:
    .venv\\Scripts\\python.exe scripts\\smoke_test_plc.py

Expected output:
    connected
    set B0=True ... read B0: True
    write W100=2500 ... read W100: 2500
    subscribing to events for 2 s ...
    <any PLC->Web events printed>
    disconnected ok
"""
import sys
import time
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config import PlcConfig
from app.hardware.base import PlcEvent
from app.hardware.plc import RealPlc

received_events: list[PlcEvent] = []


def on_event(evt: PlcEvent) -> None:
    received_events.append(evt)
    print(f"  EVENT: {evt}")


def main() -> None:
    cfg = PlcConfig()
    plc = RealPlc(cfg)

    # --- connect ---
    print("connecting ...")
    plc.connect()
    print(f"connected: {plc.is_connected}")
    assert plc.is_connected, "connect() did not set is_connected"

    plc.subscribe(on_event)

    # --- set_bit B0 -> MR0 ---
    print("set B0=True ...")
    plc.set_bit(0, True)
    time.sleep(0.05)
    val = plc.read_bit(0)
    print(f"read B0: {val}")
    assert val is True, f"Expected True, got {val!r}"

    plc.set_bit(0, False)
    time.sleep(0.05)
    val = plc.read_bit(0)
    print(f"read B0 after reset: {val}")
    assert val is False, f"Expected False, got {val!r}"

    # --- write_word W100 -> DM100 ---
    print("write W100=2500 ...")
    plc.write_word(100, 2500)
    time.sleep(0.05)
    rval = plc.read_word(100)
    print(f"read W100: {rval}")
    assert rval == 2500, f"Expected 2500, got {rval!r}"

    # restore to 0
    plc.write_word(100, 0)

    # --- event subscription (2 s) ---
    print("subscribing to events for 2 s ...")
    time.sleep(2.0)
    if received_events:
        print(f"received {len(received_events)} events from PLC")
    else:
        print("no edge events in 2 s (normal if PLC->Web bits are stable)")

    # --- disconnect ---
    print("disconnecting ...")
    plc.disconnect()
    assert not plc.is_connected, "disconnect() did not clear is_connected"
    print("disconnected ok")


if __name__ == "__main__":
    main()
