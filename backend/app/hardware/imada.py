from __future__ import annotations

import re
import threading
import time
from typing import Callable, List, Optional

import serial
from loguru import logger

from app.config import ImadaConfig
from app.hardware.base import ImadaReading

# Imada ZT-series Remote-mode response:
#   <sign><value><unit><mode?><judgment?><CR>
# Examples seen on real hardware:
#   "+0.000NTO\r"   value=+0.000, unit=N, mode=T (Track), judgment=O (OK)
#   "+12.345N\r"    bare form (no mode/judgment configured)
# We accept any trailing uppercase letters/hyphens after the unit and ignore them.
_LINE_RE = re.compile(r"^([+-]?\d+\.\d+)(N|KN|kgf|gf|lbf|ozf)([A-Z\-]*)$")


class RealImada:
    """RS232 driver for Imada ZT-series force gauge in Remote/poll mode.

    The gauge does NOT push samples on its own. The host must send ``D\\r`` for
    every sample and parse the reply. We run a worker thread that sends ``D\\r``
    every ``poll_interval_ms`` and emits a parsed ``ImadaReading``.

    Non-N units are dropped (no auto-conversion). Set the gauge to N on the device.
    """

    def __init__(self, config: ImadaConfig):
        self._cfg = config
        self._port: Optional[serial.Serial] = None
        self._subs: List[Callable[[ImadaReading], None]] = []
        self._connected = False
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._io_lock = threading.Lock()

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
            timeout=0.2,
            write_timeout=0.2,
        )
        self._connected = True
        logger.info("Imada connected on {} @ {} baud", self._cfg.port, self._cfg.baud)

    def disconnect(self) -> None:
        if not self._connected:
            return
        self.stop_stream()
        self._connected = False
        if self._port and self._port.is_open:
            self._port.close()
        self._port = None
        logger.info("Imada disconnected")

    def subscribe(self, cb: Callable[[ImadaReading], None]) -> None:
        self._subs.append(cb)

    def start_stream(self) -> None:
        # Replace a dead thread reference — the worker exits on serial error,
        # leaving self._thread pointing at a terminated Thread object.  Without
        # this is_alive() check, a reconnect could never re-spawn the worker.
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="imada-poll")
        self._thread.start()

    def stop_stream(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def tare(self) -> None:
        """Send the ZT-series zero command ('Z\\r') to tare the force gauge."""
        if self._port is None or not self._port.is_open:
            logger.warning("Imada tare: port not open")
            return
        with self._io_lock:
            self._port.reset_input_buffer()
            self._port.write(b"Z\r")
            # Drain any acknowledgement byte within the existing read timeout.
            self._port.read(8)
        logger.info("Imada tare command sent")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _emit(self, reading: ImadaReading) -> None:
        for cb in self._subs:
            try:
                cb(reading)
            except Exception:
                logger.exception("Imada subscriber raised")

    def _run(self) -> None:
        interval = max(self._cfg.poll_interval_ms, 5) / 1000.0
        next_tick = time.monotonic()
        while not self._stop_event.is_set():
            try:
                self._poll_once()
            except serial.SerialException:
                logger.exception("Imada serial error; stopping poll thread")
                self._connected = False
                return
            except Exception:
                logger.exception("Imada unexpected poll error")

            next_tick += interval
            sleep_for = next_tick - time.monotonic()
            if sleep_for > 0:
                self._stop_event.wait(sleep_for)
            else:
                # Falling behind — reset baseline so we don't spin.
                next_tick = time.monotonic()

    def _poll_once(self) -> None:
        if self._port is None or not self._port.is_open:
            raise serial.SerialException("Port not open")

        with self._io_lock:
            self._port.reset_input_buffer()
            self._port.write(b"D\r")
            # Read until CR or timeout (0.2 s from connect()).
            line = self._port.read_until(b"\r", size=32)

        if not line:
            logger.debug("Imada poll: no reply")
            return

        self._handle_line(line.rstrip(b"\r\n").decode("ascii", errors="replace"))

    def _handle_line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return
        m = _LINE_RE.match(line)
        if not m:
            logger.debug("Imada unparseable line: {!r}", line)
            return
        value_str, unit, _trailing = m.group(1), m.group(2), m.group(3)
        if unit != "N":
            logger.warning("Imada unit mismatch: expected N, got {}; dropping sample", unit)
            return
        self._emit(ImadaReading(
            timestamp_ns=time.monotonic_ns(),
            force_n=float(value_str),
            unit="N",
        ))
