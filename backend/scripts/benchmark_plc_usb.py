"""
Benchmark KVComPlus over USB — measure read/write latency.

Run from backend/ with the 32-bit Python:
    py32\\python.exe scripts\\benchmark_plc_usb.py

Tests:
  1) Single DBRead loop — baseline latency per call
  2) DBKvRegMonitorBit + DBKvReadMonitorDataBit — bulk monitor (designed for fast polling)
  3) DBReadArea — sequential read of N words in one call
  4) DBWrite loop — write throughput
"""
import ctypes
import os
import sys
import time

DLL_DIR = r"C:\Program Files (x86)\KEYENCE\KVComPlusLB\bin"
os.add_dll_directory(DLL_DIR)
dll = ctypes.WinDLL(os.path.join(DLL_DIR, "DataBuilder.dll"))

DB_NOERROR = 0
DBPLC_KV3000 = 0x0203
KV3000_MR = 12
KV3000_DM = 18
DB_DEVITM_MAX = 512


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
dll.DBReadArea.argtypes = [ctypes.c_void_p, ctypes.c_uint16, ctypes.c_uint32, ctypes.c_long, ctypes.POINTER(DBDevInfo)]
dll.DBKvRegMonitorBit.restype = ctypes.c_long
dll.DBKvRegMonitorBit.argtypes = [ctypes.c_void_p, ctypes.c_uint8, ctypes.c_long, ctypes.POINTER(DBDevInfo)]
dll.DBKvReadMonitorDataBit.restype = ctypes.c_long
dll.DBKvReadMonitorDataBit.argtypes = [ctypes.c_void_p, ctypes.c_uint8, ctypes.c_long, ctypes.POINTER(DBDevInfo)]


if not dll.DBInit():
    print("DBInit FAILED")
    sys.exit(1)

handle = ctypes.c_void_p(0)
if dll.DBConnectA(b"USB", DBPLC_KV3000, ctypes.byref(handle)) or not handle.value:
    print("Connect failed")
    sys.exit(1)
print(f"Connected, handle={hex(handle.value)}\n")

N = 200  # iterations

# === Benchmark 1: single DBRead in a tight loop ===
d = DBDevInfo(); d.wKind = KV3000_MR; d.dwNo = 4000
t0 = time.perf_counter()
for _ in range(N):
    dll.DBRead(handle, ctypes.byref(d))
dt = time.perf_counter() - t0
print(f"[1] Single DBRead x{N}: {dt*1000:.1f} ms total  ->  {dt*1000/N:.2f} ms/call  ({N/dt:.0f} reads/sec)")

# === Benchmark 2: monitor (bulk bit read for B5/B6/B7) ===
# Register 3 bits (MR4000, MR4001, MR4002) and read them as a batch
mon = (DBDevInfo * 3)()
for i in range(3):
    mon[i].wKind = KV3000_MR
    mon[i].dwNo = 4000 + i
rc = dll.DBKvRegMonitorBit(handle, 0, 3, mon)
print(f"\n[2] DBKvRegMonitorBit(3 bits) rc={rc}")

t0 = time.perf_counter()
for _ in range(N):
    dll.DBKvReadMonitorDataBit(handle, 0, 3, mon)
dt = time.perf_counter() - t0
print(f"[2] DBKvReadMonitorDataBit (3 bits) x{N}: {dt*1000:.1f} ms total  ->  {dt*1000/N:.2f} ms/call  ({N/dt:.0f} polls/sec)")
print(f"    values: MR4000={mon[0].lValue} MR4001={mon[1].lValue} MR4002={mon[2].lValue}")

# === Benchmark 3: sequential read of 16 DM words ===
buf = (DBDevInfo * 16)()
t0 = time.perf_counter()
for _ in range(N):
    dll.DBReadArea(handle, KV3000_DM, 0, 16, buf)
dt = time.perf_counter() - t0
print(f"\n[3] DBReadArea(DM0, 16 words) x{N}: {dt*1000:.1f} ms total  ->  {dt*1000/N:.2f} ms/call")

# === Benchmark 4: write loop (W10 heartbeat simulation) ===
d = DBDevInfo(); d.wKind = KV3000_DM; d.dwNo = 10
t0 = time.perf_counter()
for i in range(N):
    d.lValue = i
    dll.DBWrite(handle, ctypes.byref(d))
dt = time.perf_counter() - t0
print(f"\n[4] DBWrite DM10 x{N}: {dt*1000:.1f} ms total  ->  {dt*1000/N:.2f} ms/call  ({N/dt:.0f} writes/sec)")

dll.DBDisconnect(handle)
print("\nDisconnected.")
