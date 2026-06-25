"""
plc_bridge.py — 32-bit KVComPlus DataBuilder bridge.

Run under backend/py32/python.exe (32-bit embedded Python, stdlib only).
Exposes a ThreadingHTTPServer on a configurable port; the 64-bit parent
process talks to it over localhost HTTP.

Usage:
    py32\\python.exe plc_bridge.py [port]   (default port = 8765)

Design:
- One threading.Lock serialises ALL DLL calls.
- PollingThread: DBKvReadMonitorDataBit on registered poll bits, emits edge events.
- HeartbeatThread: DBWrite on a word device every N ms with incrementing counter.
- Events deque (maxlen=1000): each entry {"ts_ns": int, "addr": int, "value": 0|1}.
  'addr' is the *abstract bit address* (0-7), not the MR number.
- GET /events?after=<ts_ns> long-polls up to 1 s when the deque is empty.
"""
import ctypes
import json
import os
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# ---------------------------------------------------------------------------
# DLL setup — verbatim from test_plc_kvcomplus.py
# ---------------------------------------------------------------------------

DLL_DIR = r"C:\Program Files (x86)\KEYENCE\KVComPlusLB\bin"
os.add_dll_directory(DLL_DIR)
dll = ctypes.WinDLL(os.path.join(DLL_DIR, "DataBuilder.dll"))

DB_NOERROR = 0
DBPLC_KV3000 = 0x0203
KV3000_MR = 12
KV3000_DM = 18
DB_DEVITM_MAX = 512

MAX_MONITOR_BITS = 32  # DBKvRegMonitorBit bank slot count per bank


class DBDevInfo(ctypes.Structure):
    _pack_ = 8
    _fields_ = [
        ("wKind", ctypes.c_uint16),
        ("dwNo", ctypes.c_uint32),
        ("lValue", ctypes.c_int32),
        ("wRTLDataSize", ctypes.c_uint16),
        ("wRTLDataType", ctypes.c_uint16),
        ("wRTLDispType", ctypes.c_uint16),
        ("wRTLManageIndex", ctypes.c_uint32),
        ("szNo", ctypes.c_wchar * DB_DEVITM_MAX),
    ]


dll.DBInit.restype = ctypes.c_bool
dll.DBConnectA.restype = ctypes.c_long
dll.DBConnectA.argtypes = [ctypes.c_char_p, ctypes.c_uint16, ctypes.POINTER(ctypes.c_void_p)]
dll.DBDisconnect.restype = ctypes.c_long
dll.DBDisconnect.argtypes = [ctypes.c_void_p]
dll.DBRead.restype = ctypes.c_long
dll.DBRead.argtypes = [ctypes.c_void_p, ctypes.POINTER(DBDevInfo)]
dll.DBWrite.restype = ctypes.c_long
dll.DBWrite.argtypes = [ctypes.c_void_p, ctypes.POINTER(DBDevInfo)]
dll.DBReadArea.restype = ctypes.c_long
dll.DBReadArea.argtypes = [
    ctypes.c_void_p, ctypes.c_uint16, ctypes.c_uint32,
    ctypes.c_long, ctypes.POINTER(DBDevInfo),
]
dll.DBKvRegMonitorBit.restype = ctypes.c_long
dll.DBKvRegMonitorBit.argtypes = [
    ctypes.c_void_p, ctypes.c_uint8, ctypes.c_long, ctypes.POINTER(DBDevInfo),
]
dll.DBKvReadMonitorDataBit.restype = ctypes.c_long
dll.DBKvReadMonitorDataBit.argtypes = [
    ctypes.c_void_p, ctypes.c_uint8, ctypes.c_long, ctypes.POINTER(DBDevInfo),
]
# Mode + error management — needed when PLC boots into PROG mode or has a stale
# error state from a previous session (KVDH1L manual §5-13 / §5-57).
dll.DBChangeMode.restype = ctypes.c_long
dll.DBChangeMode.argtypes = [ctypes.c_void_p, ctypes.c_int]
dll.DBQueryMode.restype = ctypes.c_long
dll.DBQueryMode.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
dll.DBKvClearError.restype = ctypes.c_long
dll.DBKvClearError.argtypes = [ctypes.c_void_p]

# DBMode enum (from DataBuilder.h)
DB_MODE_KV700_RUN = 1
DB_MODE_KV700_PROG = 2

# ---------------------------------------------------------------------------
# Bridge state
# ---------------------------------------------------------------------------

import queue
from concurrent.futures import Future

# The DataBuilder DLL has thread affinity — only the thread that called
# DBInit + DBConnect can call DBRead/DBWrite. So ALL DLL calls are routed
# through a single dedicated worker thread via _dll_q. Callers post a
# (callable, args) tuple and a Future; the worker drains the queue and
# completes futures. This replaces the old _dll_lock-based approach.
_dll_q: "queue.Queue[tuple]" = queue.Queue()
_dll_worker_thread: threading.Thread | None = None
_dll_lock = threading.Lock()  # kept for legacy callsites that don't use _dll_call

def _dll_call(fn, *args, timeout: float = 10.0):
    """Submit a DLL call; block on the dedicated worker thread, return its result."""
    fut: Future = Future()
    _dll_q.put((fn, args, fut))
    return fut.result(timeout=timeout)

def _dll_worker_loop() -> None:
    """The ONE thread that touches the DLL. Started at program init."""
    # DBInit must be called here too — the DLL associates session with the calling thread.
    if not dll.DBInit():
        print("[bridge] DBInit FAILED in worker", file=sys.stderr, flush=True)
        return
    print("[bridge] dll worker started, DBInit ok", file=sys.stderr, flush=True)
    while True:
        item = _dll_q.get()
        if item is None:
            break
        fn, args, fut = item
        try:
            fut.set_result(fn(*args))
        except Exception as e:
            fut.set_exception(e)

_handle: ctypes.c_void_p = ctypes.c_void_p(0)
_connected = False
_start_time = time.monotonic()

_events: deque = deque(maxlen=1000)
_events_cond = threading.Condition()  # notified on new event append

# Poll state
_poll_thread: threading.Thread | None = None
_poll_stop = threading.Event()
_poll_bits_arr = None   # (DBDevInfo * N) array — only used in monitor mode
_poll_bit_map: list[dict] = []   # list of {"kind": k, "num": n, "abstract_addr": a}
_poll_count = 0
_poll_interval = 0.020  # seconds
_poll_fallback = False  # True when DBKvRegMonitorBit failed; use individual DBRead

# Heartbeat state
_hb_thread: threading.Thread | None = None
_hb_stop = threading.Event()
_hb_kind = KV3000_DM
_hb_num = 10
_hb_interval = 0.200  # seconds


# ---------------------------------------------------------------------------
# DLL helpers (all called with _dll_lock held by caller)
# ---------------------------------------------------------------------------

def _do_read(kind: int, num: int) -> tuple[int, int]:
    d = DBDevInfo(); d.wKind = kind; d.dwNo = num
    rc = dll.DBRead(_handle, ctypes.byref(d))
    return rc, int(d.lValue)


def _do_write(kind: int, num: int, value: int) -> int:
    d = DBDevInfo(); d.wKind = kind; d.dwNo = num; d.lValue = value
    return dll.DBWrite(_handle, ctypes.byref(d))


def _dll_read_bit(kind: int, num: int) -> tuple[int, int]:
    return _dll_call(_do_read, kind, num)


def _dll_write_bit(kind: int, num: int, value: int) -> int:
    return _dll_call(_do_write, kind, num, 1 if value else 0)


def _dll_read_word(kind: int, num: int) -> tuple[int, int]:
    return _dll_call(_do_read, kind, num)


def _dll_write_word(kind: int, num: int, value: int) -> int:
    return _dll_call(_do_write, kind, num, value)


# ---------------------------------------------------------------------------
# Polling thread
# ---------------------------------------------------------------------------

def _poll_loop() -> None:
    global _poll_bits_arr, _poll_count, _poll_bit_map
    last_values: dict[int, int] = {}
    mode_label = "fallback" if _poll_fallback else "monitor"
    print(f"[bridge] poll thread started (mode={mode_label})", file=sys.stderr, flush=True)
    while not _poll_stop.is_set():
        if _connected and _poll_bit_map and _poll_count > 0:
            if _poll_fallback:
                # Fallback: individual DBRead per bit, all under one lock acquisition
                ts = time.monotonic_ns()
                with _dll_lock:
                    reads = []
                    for info in _poll_bit_map:
                        rc, val = _dll_read_bit(info["kind"], info["num"])
                        reads.append((info["abstract_addr"], rc, val))
                for addr, rc, val in reads:
                    if rc != DB_NOERROR:
                        print(f"[bridge] fallback DBRead MR{addr} rc={rc}", file=sys.stderr, flush=True)
                        continue
                    if last_values.get(addr, -1) != val:
                        last_values[addr] = val
                        evt = {"ts_ns": ts, "addr": addr, "value": val}
                        with _events_cond:
                            _events.append(evt)
                            _events_cond.notify_all()
            else:
                # Monitor mode: single DBKvReadMonitorDataBit call for all bits
                with _dll_lock:
                    rc = dll.DBKvReadMonitorDataBit(_handle, 0, _poll_count, _poll_bits_arr)
                if rc == DB_NOERROR:
                    ts = time.monotonic_ns()
                    for i, info in enumerate(_poll_bit_map):
                        val = int(_poll_bits_arr[i].lValue)
                        addr = info["abstract_addr"]
                        if last_values.get(addr, -1) != val:
                            last_values[addr] = val
                            evt = {"ts_ns": ts, "addr": addr, "value": val}
                            with _events_cond:
                                _events.append(evt)
                                _events_cond.notify_all()
                else:
                    print(f"[bridge] DBKvReadMonitorDataBit rc={rc}", file=sys.stderr, flush=True)
        _poll_stop.wait(_poll_interval)
    print("[bridge] poll thread stopped", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Heartbeat thread
# ---------------------------------------------------------------------------

def _heartbeat_loop() -> None:
    counter = 0
    print("[bridge] heartbeat thread started", file=sys.stderr, flush=True)
    while not _hb_stop.is_set():
        if _connected:
            with _dll_lock:
                rc = _dll_write_word(_hb_kind, _hb_num, counter % 32768)
            if rc != DB_NOERROR:
                print(f"[bridge] heartbeat write rc={rc}", file=sys.stderr, flush=True)
            counter += 1
        _hb_stop.wait(_hb_interval)
    print("[bridge] heartbeat thread stopped", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------

def _json_resp(handler: BaseHTTPRequestHandler, code: int, body: dict) -> None:
    data = json.dumps(body).encode()
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _read_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if length == 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw)


class BridgeHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):  # suppress default access log
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/status":
            polling_active = _poll_thread is not None and _poll_thread.is_alive()
            if not polling_active:
                poll_mode_str = None
            elif _poll_fallback:
                poll_mode_str = "fallback"
            else:
                poll_mode_str = "monitor"
            _json_resp(self, 200, {
                "connected": _connected,
                "polling": polling_active,
                "poll_mode": poll_mode_str,
                "uptime_s": time.monotonic() - _start_time,
            })

        elif path == "/events":
            after = int(qs.get("after", ["0"])[0])
            # Collect immediately available events
            found = []
            with _events_cond:
                found = [e for e in _events if e["ts_ns"] > after]
                if not found:
                    # Long-poll: wait up to 1 second for new events
                    _events_cond.wait(timeout=1.0)
                    found = [e for e in _events if e["ts_ns"] > after]
            _json_resp(self, 200, {"events": found})

        else:
            _json_resp(self, 404, {"error": "not found"})

    def do_POST(self):
        global _connected, _handle
        global _poll_thread, _poll_bits_arr, _poll_bit_map, _poll_count, _poll_interval, _poll_fallback
        global _hb_thread, _hb_kind, _hb_num, _hb_interval

        parsed = urlparse(self.path)
        path = parsed.path

        try:
            body = _read_body(self)
        except Exception as exc:
            _json_resp(self, 400, {"ok": False, "error_msg": f"bad JSON: {exc}"})
            return

        # ---- /connect ----
        if path == "/connect":
            if _connected:
                _json_resp(self, 200, {"ok": True, "note": "already connected"})
                return
            plc_id = body.get("plc_id", DBPLC_KV3000)
            dest = body.get("dest", "USB")
            dest_b = dest.encode("ascii")
            h = ctypes.c_void_p(0)

            def _connect_op():
                # Runs on the dll worker thread — must be the same thread as later reads.
                return dll.DBConnectA(dest_b, ctypes.c_uint16(plc_id), ctypes.byref(h))

            rc = _dll_call(_connect_op, timeout=20.0)
            if rc != DB_NOERROR or not h.value:
                print(f"[bridge] DBConnectA rc={rc}", file=sys.stderr, flush=True)
                _json_resp(self, 200, {"ok": False, "error_code": rc,
                                       "error_msg": f"DBConnectA failed rc={rc}"})
                return
            _handle = h
            _connected = True
            print(f"[bridge] connected handle={hex(h.value)}", file=sys.stderr, flush=True)

            # Clear any stale error state, query current mode, force RUN if needed.
            # Runs on the dll worker thread.
            cur_mode = ctypes.c_int(0)
            def _setup_op():
                err = dll.DBKvClearError(_handle)
                mr = dll.DBQueryMode(_handle, ctypes.byref(cur_mode))
                if mr == DB_NOERROR and cur_mode.value != DB_MODE_KV700_RUN:
                    dll.DBChangeMode(_handle, DB_MODE_KV700_RUN)
                return err, mr
            err_rc, mode_rc = _dll_call(_setup_op)
            print(
                f"[bridge] DBKvClearError rc={err_rc}, DBQueryMode rc={mode_rc} mode={cur_mode.value}",
                file=sys.stderr, flush=True,
            )
            _json_resp(self, 200, {
                "ok": True,
                "mode": cur_mode.value,
                "clear_error_rc": err_rc,
            })

        # ---- /disconnect ----
        elif path == "/disconnect":
            if not _connected:
                _json_resp(self, 200, {"ok": True})
                return
            _connected = False
            _dll_call(dll.DBDisconnect, _handle)
            _handle = ctypes.c_void_p(0)
            print("[bridge] disconnected", file=sys.stderr, flush=True)
            _json_resp(self, 200, {"ok": True})

        # ---- /start_polling ----
        elif path == "/start_polling":
            if _poll_thread is not None and _poll_thread.is_alive():
                _json_resp(self, 200, {"ok": True, "note": "already polling"})
                return
            bits_cfg = body.get("poll_bits", [
                {"kind": KV3000_MR, "num": 5},
                {"kind": KV3000_MR, "num": 6},
                {"kind": KV3000_MR, "num": 7},
            ])
            interval_ms = body.get("interval_ms", 20)
            _poll_interval = interval_ms / 1000.0
            count = len(bits_cfg)
            arr = (DBDevInfo * count)()
            bit_map = []
            for i, b in enumerate(bits_cfg):
                arr[i].wKind = b["kind"]
                arr[i].dwNo = b["num"]
                bit_map.append({
                    "kind": b["kind"],
                    "num": b["num"],
                    "abstract_addr": b.get("abstract_addr", b["num"]),
                })
            # IMPORTANT: skip DBKvRegMonitorBit entirely on KV-3000 — empirically it
            # returns rc=-12 for our MR addresses AND corrupts the DLL session so all
            # subsequent DBRead calls also return -12.  Go straight to fallback mode
            # (individual DBRead per bit per cycle).  Still well under the 20 ms budget.
            use_monitor = body.get("use_monitor", False)
            if use_monitor:
                with _dll_lock:
                    rc = dll.DBKvRegMonitorBit(_handle, 0, count, arr)
            else:
                rc = -999  # synthetic — force fallback path
            if rc != DB_NOERROR:
                if use_monitor:
                    print(
                        f"[bridge] DBKvRegMonitorBit rc={rc} — switching to fallback DBRead mode",
                        file=sys.stderr, flush=True,
                    )
                _poll_fallback = True
                poll_mode = "fallback"
                poll_note = "individual DBRead per bit (monitor API skipped on KV-3000)"
            else:
                _poll_fallback = False
                poll_mode = "monitor"
                poll_note = None
            _poll_bits_arr = arr
            _poll_bit_map = bit_map
            _poll_count = count
            _poll_stop.clear()
            t = threading.Thread(target=_poll_loop, daemon=True, name="plc-poll")
            _poll_thread = t
            t.start()
            resp_body = {"ok": True, "mode": poll_mode}
            if poll_note:
                resp_body["note"] = poll_note
            _json_resp(self, 200, resp_body)

        # ---- /stop_polling ----
        elif path == "/stop_polling":
            _poll_stop.set()
            if _poll_thread:
                _poll_thread.join(timeout=2)
            _json_resp(self, 200, {"ok": True})

        # ---- /start_heartbeat ----
        elif path == "/start_heartbeat":
            if _hb_thread is not None and _hb_thread.is_alive():
                _json_resp(self, 200, {"ok": True, "note": "already running"})
                return
            _hb_kind = body.get("kind", KV3000_DM)
            _hb_num = body.get("num", 10)
            _hb_interval = body.get("interval_ms", 200) / 1000.0
            _hb_stop.clear()
            t = threading.Thread(target=_heartbeat_loop, daemon=True, name="plc-hb")
            _hb_thread = t
            t.start()
            _json_resp(self, 200, {"ok": True})

        # ---- /stop_heartbeat ----
        elif path == "/stop_heartbeat":
            _hb_stop.set()
            if _hb_thread:
                _hb_thread.join(timeout=2)
            _json_resp(self, 200, {"ok": True})

        # ---- /read_bit ----
        elif path == "/read_bit":
            kind = body.get("kind", KV3000_MR)
            num = body.get("num", 0)
            with _dll_lock:
                rc, val = _dll_read_bit(kind, num)
            if rc != DB_NOERROR:
                _json_resp(self, 200, {"ok": False, "error_code": rc,
                                       "error_msg": f"DBRead rc={rc}"})
                return
            _json_resp(self, 200, {"ok": True, "value": val})

        # ---- /write_bit ----
        elif path == "/write_bit":
            kind = body.get("kind", KV3000_MR)
            num = body.get("num", 0)
            value = body.get("value", 0)
            with _dll_lock:
                rc = _dll_write_bit(kind, num, value)
            if rc != DB_NOERROR:
                _json_resp(self, 200, {"ok": False, "error_code": rc,
                                       "error_msg": f"DBWrite rc={rc}"})
                return
            _json_resp(self, 200, {"ok": True})

        # ---- /read_word ----
        elif path == "/read_word":
            kind = body.get("kind", KV3000_DM)
            num = body.get("num", 0)
            with _dll_lock:
                rc, val = _dll_read_word(kind, num)
            if rc != DB_NOERROR:
                _json_resp(self, 200, {"ok": False, "error_code": rc,
                                       "error_msg": f"DBRead rc={rc}"})
                return
            _json_resp(self, 200, {"ok": True, "value": val})

        # ---- /write_word ----
        elif path == "/write_word":
            kind = body.get("kind", KV3000_DM)
            num = body.get("num", 0)
            value = body.get("value", 0)
            with _dll_lock:
                rc = _dll_write_word(kind, num, value)
            if rc != DB_NOERROR:
                _json_resp(self, 200, {"ok": False, "error_code": rc,
                                       "error_msg": f"DBWrite rc={rc}"})
                return
            _json_resp(self, 200, {"ok": True})

        else:
            _json_resp(self, 404, {"error": "not found"})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

    # DBInit must succeed before any other call
    # Start the dedicated DLL worker thread BEFORE any DLL calls.
    # DBInit happens inside the worker so it owns the DLL session.
    threading.Thread(target=_dll_worker_loop, daemon=True, name="dll-worker").start()
    # Wait briefly for the worker to call DBInit
    time.sleep(0.3)
    print(f"[bridge] listening on :{port}", file=sys.stderr, flush=True)

    server = ThreadingHTTPServer(("127.0.0.1", port), BridgeHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if _connected:
            try:
                _dll_call(dll.DBDisconnect, _handle, timeout=2)
            except Exception:
                pass
        # Signal worker to exit
        _dll_q.put(None)
        print("[bridge] shutdown", file=sys.stderr, flush=True)
