"""
Sanity test for RealImada (Imada ZTS/ZTA force gauge over RS232).

Reads the continuous ASCII stream for a short window and prints parsed samples
plus simple stats (count, rate, min/max). Reuses backend.app.hardware.imada
so the wire format + parser match what the FastAPI service will use.

Prerequisites:
    1. Imada gauge connected, powered, and in *Continuous Output* mode.
    2. Unit on the gauge set to N (driver rejects other units).
    3. **Close Force Logger first** — Windows lets only ONE process hold a COM
       port at a time. If Force Logger is still open you will get
       "PermissionError: could not open port".

Run from backend/:
    .venv\\Scripts\\python.exe scripts\\smoke_test_imada.py
    .venv\\Scripts\\python.exe scripts\\smoke_test_imada.py --port COM4 --baud 19200 --seconds 10
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config import ImadaConfig
from app.hardware.base import ImadaReading
from app.hardware.imada import RealImada


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM4", help="Serial port (default: COM4)")
    ap.add_argument("--baud", type=int, default=19200, help="Baud rate (default: 19200)")
    ap.add_argument("--seconds", type=float, default=5.0, help="How long to listen (default: 5 s)")
    ap.add_argument("--poll-ms", type=int, default=13, help="Poll interval in ms (default: 13 = ~75 Hz; hardware ceiling ~130 Hz)")
    args = ap.parse_args()

    cfg = ImadaConfig(enabled=True, port=args.port, baud=args.baud, poll_interval_ms=args.poll_ms)
    gauge = RealImada(cfg)

    samples: list[ImadaReading] = []

    def on_sample(r: ImadaReading) -> None:
        samples.append(r)
        if len(samples) <= 10 or len(samples) % 50 == 0:
            print(f"  [{len(samples):4d}] {r.force_n:+8.3f} {r.unit}")

    gauge.subscribe(on_sample)

    print(f"opening {args.port} @ {args.baud} baud ...")
    try:
        gauge.connect()
    except Exception as e:
        print(f"FAILED to open port: {e}")
        print("  -> If Force Logger is open, close it (Windows allows only one app per COM port).")
        print("  -> Check Device Manager for the correct COM number.")
        return 1

    print(f"connected: {gauge.is_connected}")
    print(f"starting stream for {args.seconds} s ...")
    gauge.start_stream()

    t0 = time.monotonic()
    try:
        while time.monotonic() - t0 < args.seconds:
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("interrupted")

    elapsed = time.monotonic() - t0
    print("stopping ...")
    gauge.disconnect()

    print("-" * 40)
    print(f"elapsed:   {elapsed:.2f} s")
    print(f"samples:   {len(samples)}")
    if samples:
        rate = len(samples) / elapsed
        forces = [s.force_n for s in samples]
        print(f"rate:      {rate:.1f} Hz")
        print(f"min/max:   {min(forces):+.3f} / {max(forces):+.3f} N")
        print(f"first/last:{samples[0].force_n:+.3f} / {samples[-1].force_n:+.3f} N")
        return 0
    else:
        print("NO samples received.")
        print("  -> Check the gauge is in Continuous Output mode (not single-shot).")
        print("  -> Check baud / parity match Force Logger settings.")
        print("  -> Verify the gauge unit is N (driver drops kgf/lbf samples).")
        return 2


if __name__ == "__main__":
    sys.exit(main())
