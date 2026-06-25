from __future__ import annotations

import struct
import threading
import time
from typing import Callable, List, Optional

import serial
from loguru import logger

from app.config import Esp32Config
from app.hardware.base import Esp32Reading

# Binary frame format (no terminator, continuous stream):
#   [0x AA 0x55] [f64 little-endian, 8 bytes]  = 10 bytes total
#   The float64 is force in Newtons, already calibrated by the firmware.
_HEADER = b"\xAA\x55"
_FRAME_SIZE = 10   # 2 header + 8 payload
_PAYLOAD_SIZE = 8


class RealEsp32:
    """RS232 passive driver for ESP32 clamp-force sensor (continuous push, binary frames)."""

    def __init__(self, config: Esp32Config):
        self._cfg = config
        self._port: Optional[serial.Serial] = None
        self._subs: List[Callable[[Esp32Reading], None]] = []
        self._connected = False
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------
    # Protocol interface
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        if self._connected:
            return
        self._stop_event.clear()
        self._port = serial.Serial(
            port=self._cfg.port,
            baudrate=self._cfg.baud,
            timeout=0.5,
        )
        self._connected = True
        logger.info("ESP32 connected on {} @ {} baud", self._cfg.port, self._cfg.baud)

    def disconnect(self) -> None:
        if not self._connected:
            return
        self.stop_stream()
        self._connected = False
        if self._port and self._port.is_open:
            self._port.close()
        self._port = None
        logger.info("ESP32 disconnected")

    def subscribe(self, cb: Callable[[Esp32Reading], None]) -> None:
        self._subs.append(cb)

    def start_stream(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="esp32-read")
        self._thread.start()

    def stop_stream(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def tare(self) -> None:
        """Send tare command ('t') to ESP32 firmware over RS232."""
        if self._port is None or not self._port.is_open:
            logger.warning("ESP32 tare: port not open")
            return
        self._port.write(b"t")
        logger.info("ESP32 tare command sent")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _emit(self, reading: Esp32Reading) -> None:
        for cb in self._subs:
            try:
                cb(reading)
            except Exception:
                logger.exception("ESP32 subscriber raised")

    def _run(self) -> None:
        buf = b""
        while not self._stop_event.is_set():
            try:
                if self._port is None or not self._port.is_open:
                    raise serial.SerialException("Port not open")
                chunk = self._port.read(128)
            except serial.SerialException:
                logger.exception("ESP32 read error; stopping stream thread")
                self._connected = False
                return
            except Exception:
                logger.exception("ESP32 unexpected read error")
                self._stop_event.wait(0.05)
                continue

            if not chunk:
                continue

            buf += chunk
            buf = self._drain(buf)

    def _drain(self, buf: bytes) -> bytes:
        """Consume all complete frames from buf; return unconsumed tail."""
        while True:
            idx = buf.find(_HEADER)
            if idx == -1:
                # No header anywhere — keep last byte in case it's the first half of a header
                return buf[-1:] if buf else b""
            if idx > 0:
                # Garbage before header — discard it
                logger.debug("ESP32 discarding {} garbage bytes before header", idx)
                buf = buf[idx:]
            if len(buf) < _FRAME_SIZE:
                break  # Wait for more bytes
            payload = buf[2:_FRAME_SIZE]
            force_n = struct.unpack("<d", payload)[0]
            self._emit(Esp32Reading(
                timestamp_ns=time.monotonic_ns(),
                force_n=force_n,
                raw=0,
            ))
            buf = buf[_FRAME_SIZE:]
        return buf
