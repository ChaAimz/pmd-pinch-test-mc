"""
Sanity test for RealEsp32 — binary-frame protocol.

Frame format: 0xAA 0x55 + float64 little-endian (8 bytes) = 10 bytes, no terminator.

Run from backend/:
    .venv\\Scripts\\python.exe scripts\\smoke_test_esp32.py
    .venv\\Scripts\\python.exe scripts\\smoke_test_esp32.py --port COM5 --seconds 5
"""
from __future__ import annotations

import argparse
import os
import struct
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import serial as _serial

from app.config import Esp32Calibration, Esp32Config
from app.hardware.base import Esp32Reading
from app.hardware.esp32 import RealEsp32


def raw_peek(port: str, baud: int) -> None:
    """Open the port briefly, read 20 bytes, print hex + decoded frames."""
    print(f"raw peek on {port} @ {baud} ...")
    try:
        p = _serial.Serial(port=port, baudrate=baud, timeout=2)
        data = p.read(20)
        p.close()
    except Exception as e:
        print(f"  peek failed: {e}")
        return

    print(f"  hex: {data.hex(' ')}")
    if len(data) >= 2:
        if data[:2] == b"\xAA\x55":
            print("  header OK: AA 55 found at byte 0")
        else:
            idx = data.find(b"\xAA\x55")
            if idx >= 0:
                print(f"  header found at offset {idx} (not frame-aligned)")
            else:
                print(f"  WARNING: AA 55 not found in first 20 bytes")
    # Decode any complete frames
    i = 0
    while i <= len(data) - 10:
        if data[i] == 0xAA and data[i + 1] == 0x55:
            val = struct.unpack("<d", data[i + 2:i + 10])[0]
            print(f"  decoded frame at [{i}]: {val:+.6f} N")
            i += 10
        else:
            i += 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM5")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--seconds", type=float, default=5.0)
    args = ap.parse_args()

    raw_peek(args.port, args.baud)
    print()

    cfg = Esp32Config(
        enabled=True,
        port=args.port,
        baud=args.baud,
        calibration=Esp32Calibration(slope=1.0, offset=0.0),
    )
    dev = RealEsp32(cfg)
    samples: list[Esp32Reading] = []

    def on_sample(r: Esp32Reading) -> None:
        samples.append(r)
        if len(samples) <= 10 or len(samples) % 10 == 0:
            print(f"  [{len(samples):4d}] {r.force_n:+8.3f} N")

    dev.subscribe(on_sample)

    print(f"opening {args.port} @ {args.baud} ...")
    try:
        dev.connect()
    except Exception as e:
        print(f"FAILED to open port: {e}")
        return 1

    print(f"connected: {dev.is_connected}")
    print(f"streaming for {args.seconds} s ...")
    dev.start_stream()

    t0 = time.monotonic()
    try:
        while time.monotonic() - t0 < args.seconds:
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("interrupted")

    elapsed = time.monotonic() - t0
    print("stopping ...")
    dev.disconnect()

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
    print("NO samples received. Check cable and that firmware is streaming.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
