"""
Real PLC driver — KVComPlus DataBuilder bridge via subprocess + HTTP.

Architecture:
- On connect(), spawn backend/py32/python.exe backend/plc_bridge.py <port>
- All DLL calls are isolated in that 32-bit process.
- This 64-bit driver communicates via localhost HTTP using `requests`.
- An event-poll thread long-polls GET /events?after=<ts_ns> and emits
  PlcEvent objects to subscribers using the same callback contract as MockPlc.

Threading:
- _event_thread: long-polls the bridge for bit-change events (daemon thread).
- All HTTP calls are blocking; callers must not call from asyncio directly —
  use asyncio.Queue + loop.call_soon_threadsafe (same pattern as mock drivers).

The addr abstraction (B0-B7, and word slots 0/10/100/102) is preserved:
- set_bit/read_bit translate via device_map.bits[addr] -> [kind, num]
- write_word/read_word translate via device_map.words[addr] -> [kind, num]
  e.g. abstract 0 -> DM28, 100 -> DM30, 102 -> DM32, 10 -> DM10
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable, List, Optional

import requests
from loguru import logger

from app.config import PlcConfig
from app.hardware.base import PlcEvent


class RealPlc:
    """KVComPlus DataBuilder bridge-based PLC driver."""

    def __init__(self, config: PlcConfig):
        self._cfg = config
        self._base_url = f"http://127.0.0.1:{config.bridge_port}"
        self._subs: List[Callable[[PlcEvent], None]] = []
        self._connected = False
        self._process: Optional[subprocess.Popen] = None
        self._stop_event = threading.Event()
        self._event_thread: Optional[threading.Thread] = None
        self._last_ts_ns: int = 0
        self._last_disconnect_time: Optional[float] = None

    # ------------------------------------------------------------------
    # Protocol interface
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._connected

    def connect(self) -> None:
        if self._connected:
            return

        # If we recently disconnected (or the previous connect attempt failed), wait
        # for the USB device to fully release before spawning a new bridge.
        # DBConnectA rc=4 (DB_ERR_OPEN_PORT) means the port is still locked;
        # 6 s is enough margin for KVComPlus to clean up the USB session.
        _RECONNECT_HOLD_S = 6.0
        if self._last_disconnect_time is not None:
            elapsed = time.monotonic() - self._last_disconnect_time
            if elapsed < _RECONNECT_HOLD_S:
                wait_s = _RECONNECT_HOLD_S - elapsed
                logger.info("PLC: recent disconnect — waiting {:.1f} s before reconnect", wait_s)
                time.sleep(wait_s)

        # Locate py32 interpreter and bridge script relative to this file's
        # package root (backend/).  __file__ = backend/app/hardware/plc.py
        backend_dir = Path(__file__).parent.parent.parent.resolve()
        py32 = backend_dir / self._cfg.bridge_python
        script = backend_dir / self._cfg.bridge_script

        if not py32.exists():
            raise FileNotFoundError(f"32-bit Python not found: {py32}")
        if not script.exists():
            raise FileNotFoundError(f"Bridge script not found: {script}")

        port = self._cfg.bridge_port
        logger.info("PLC: spawning bridge {} {} {}", py32, script, port)

        # CREATE_NEW_PROCESS_GROUP: lets us send Ctrl-Break for clean shutdown.
        # CREATE_NO_WINDOW: suppress the console window that would flash on screen.
        _win_flags = (
            subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        ) if sys.platform == "win32" else 0
        self._process = subprocess.Popen(
            [str(py32), str(script), str(port)],
            stderr=subprocess.PIPE,
            cwd=str(backend_dir),
            creationflags=_win_flags,
        )
        # Drain bridge stderr in a daemon thread so it doesn't block
        threading.Thread(
            target=self._drain_stderr,
            args=(self._process,),
            daemon=True,
            name="plc-bridge-stderr",
        ).start()

        # Wait for bridge HTTP server to be ready (up to 5 s)
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            try:
                r = requests.get(f"{self._base_url}/status", timeout=0.5)
                if r.status_code == 200:
                    break
            except requests.exceptions.ConnectionError:
                pass
            if self._process.poll() is not None:
                raise RuntimeError(
                    f"Bridge process exited early (rc={self._process.returncode})"
                )
            time.sleep(0.1)
        else:
            self._kill_process()
            raise TimeoutError("Bridge HTTP server did not respond within 5 s")

        # Connect the DLL — retry up to 3 times with 3 s gap if rc=4 (port busy).
        # DBConnectA over USB can take up to 10 s when the device is initialising,
        # so use a dedicated 15 s timeout instead of the default 3 s.
        _MAX_CONNECT_TRIES = 3
        _CONNECT_RETRY_S = 3.0
        resp: dict = {}
        for attempt in range(1, _MAX_CONNECT_TRIES + 1):
            resp = self._post("/connect", {"plc_id": self._cfg.plc_id, "dest": "USB"},
                              timeout=15.0)
            if resp.get("ok"):
                break
            err_code = resp.get("error_code", 0)
            if attempt < _MAX_CONNECT_TRIES:
                logger.warning(
                    "PLC: DBConnectA rc={} — retry {}/{} in {:.1f} s",
                    err_code, attempt, _MAX_CONNECT_TRIES, _CONNECT_RETRY_S,
                )
                time.sleep(_CONNECT_RETRY_S)
            else:
                break
        if not resp.get("ok"):
            self._kill_process()
            # Record the failure time so the next reconnect attempt waits for
            # the USB port to fully release before spawning a new bridge process.
            self._last_disconnect_time = time.monotonic()
            raise RuntimeError(
                f"Bridge /connect failed: {resp.get('error_msg', resp)}"
            )

        # Register poll bits
        dmap = self._cfg.device_map
        poll_bits = [
            {
                "kind": dmap.bits[addr][0],
                "num":  dmap.bits[addr][1],
                "abstract_addr": addr,
            }
            for addr in dmap.poll_bit_addrs
            if addr in dmap.bits
        ]
        resp = self._post("/start_polling", {
            "poll_bits": poll_bits,
            "interval_ms": self._cfg.poll_interval_ms,
        })
        if not resp.get("ok"):
            logger.warning("PLC: start_polling failed: {}", resp)

        # Start heartbeat (DM10 by default)
        hb_addr = 10  # W10 -> heartbeat word
        if hb_addr in dmap.words:
            hb_kind, hb_num = dmap.words[hb_addr]
        else:
            hb_kind, hb_num = 18, 10  # fallback DM10
        resp = self._post("/start_heartbeat", {
            "kind": hb_kind,
            "num": hb_num,
            "interval_ms": self._cfg.heartbeat_interval_ms,
        })
        if not resp.get("ok"):
            logger.warning("PLC: start_heartbeat failed: {}", resp)

        self._connected = True
        self._stop_event.clear()
        self._last_ts_ns = 0

        # Start event-poll thread
        self._event_thread = threading.Thread(
            target=self._event_poll_loop,
            daemon=True,
            name="plc-event-poll",
        )
        self._event_thread.start()
        logger.info("PLC connected via bridge on :{}", port)

    def disconnect(self) -> None:
        if not self._connected:
            return
        self._connected = False
        self._stop_event.set()

        # Ask bridge to stop cleanly
        try:
            self._post("/stop_polling", {})
        except Exception:
            pass
        try:
            self._post("/stop_heartbeat", {})
        except Exception:
            pass
        try:
            self._post("/disconnect", {})
        except Exception:
            pass

        # Join event thread
        if self._event_thread:
            self._event_thread.join(timeout=3)
            self._event_thread = None

        self._kill_process()
        self._last_disconnect_time = time.monotonic()
        logger.info("PLC disconnected (bridge stopped)")

    def subscribe(self, cb: Callable[[PlcEvent], None]) -> None:
        self._subs.append(cb)

    def write_word(self, addr: int, value: int) -> None:
        kind, num = self._word_device(addr)
        resp = self._post("/write_word", {"kind": kind, "num": num, "value": value})
        if not resp.get("ok"):
            logger.warning("PLC write_word W{} failed: {}", addr, resp)

    def read_word(self, addr: int) -> int:
        kind, num = self._word_device(addr)
        resp = self._post("/read_word", {"kind": kind, "num": num})
        if not resp.get("ok"):
            logger.warning("PLC read_word W{} failed: {}", addr, resp)
            return 0
        return int(resp.get("value", 0))

    def set_bit(self, addr: int, on: bool) -> None:
        kind, num = self._bit_device(addr)
        resp = self._post("/write_bit", {"kind": kind, "num": num, "value": 1 if on else 0})
        if not resp.get("ok"):
            logger.warning("PLC set_bit B{} failed: {}", addr, resp)

    def read_bit(self, addr: int) -> bool:
        kind, num = self._bit_device(addr)
        resp = self._post("/read_bit", {"kind": kind, "num": num})
        if not resp.get("ok"):
            logger.warning("PLC read_bit B{} failed: {}", addr, resp)
            return False
        return bool(resp.get("value", 0))

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _bit_device(self, addr: int) -> tuple[int, int]:
        """Translate abstract bit addr -> (kind, num)."""
        entry = self._cfg.device_map.bits.get(addr)
        if entry is None:
            raise KeyError(f"Unknown bit addr B{addr} — not in device_map.bits")
        return int(entry[0]), int(entry[1])

    def _word_device(self, addr: int) -> tuple[int, int]:
        """Translate abstract word addr -> (kind, num)."""
        entry = self._cfg.device_map.words.get(addr)
        if entry is None:
            raise KeyError(f"Unknown word addr W{addr} — not in device_map.words")
        return int(entry[0]), int(entry[1])

    def _post(self, path: str, body: dict, timeout: float = 3.0) -> dict:
        try:
            r = requests.post(f"{self._base_url}{path}", json=body, timeout=timeout)
            return r.json()
        except requests.exceptions.RequestException as exc:
            logger.error("PLC bridge {} error: {}", path, exc)
            return {"ok": False, "error_msg": str(exc)}

    def _emit(self, evt: PlcEvent) -> None:
        for cb in self._subs:
            try:
                cb(evt)
            except Exception:
                logger.exception("PLC subscriber raised")

    def _event_poll_loop(self) -> None:
        """Long-poll GET /events?after=<ts_ns> and emit PlcEvent.bit() to subs."""
        logger.debug("PLC event-poll thread started")
        while not self._stop_event.is_set() and self._connected:
            try:
                r = requests.get(
                    f"{self._base_url}/events",
                    params={"after": self._last_ts_ns},
                    timeout=2.0,   # bridge long-polls 1 s; add margin
                )
                data = r.json()
            except requests.exceptions.Timeout:
                continue
            except requests.exceptions.RequestException as exc:
                logger.error("PLC event poll error: {}", exc)
                self._stop_event.wait(0.5)
                continue

            events = data.get("events", [])
            for evt in events:
                ts = evt["ts_ns"]
                addr = evt["addr"]
                value = bool(evt["value"])
                if ts > self._last_ts_ns:
                    self._last_ts_ns = ts
                self._emit(PlcEvent.bit(addr, value, ts))

        logger.debug("PLC event-poll thread stopped")

    def _kill_process(self) -> None:
        if self._process is None:
            return
        try:
            self._process.terminate()
            self._process.wait(timeout=3)
        except Exception:
            try:
                self._process.kill()
            except Exception:
                pass
        self._process = None

    @staticmethod
    def _drain_stderr(proc: subprocess.Popen) -> None:
        """Forward bridge stderr to loguru. Runs in daemon thread."""
        try:
            for line in proc.stderr:
                decoded = line.decode("utf-8", errors="replace").rstrip()
                logger.debug("bridge: {}", decoded)
        except Exception:
            pass
