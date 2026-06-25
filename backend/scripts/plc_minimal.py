"""
Absolute minimum PLC diagnostic - 32-bit Python required.
Run with:  py32\python.exe scripts\plc_minimal.py
"""
import ctypes, os, sys

DLL_DIR = r"C:\Program Files (x86)\KEYENCE\KVComPlusLB\bin"
os.add_dll_directory(DLL_DIR)
dll = ctypes.WinDLL(os.path.join(DLL_DIR, "DataBuilder.dll"))

# Setup function signatures
dll.DBInit.restype = ctypes.c_bool
dll.DBConnectA.restype = ctypes.c_long
dll.DBConnectA.argtypes = [ctypes.c_char_p, ctypes.c_uint16, ctypes.POINTER(ctypes.c_void_p)]
dll.DBDisconnect.restype = ctypes.c_long
dll.DBDisconnect.argtypes = [ctypes.c_void_p]
dll.DBKvClearError.restype = ctypes.c_long
dll.DBKvClearError.argtypes = [ctypes.c_void_p]
dll.DBQueryMode.restype = ctypes.c_long
dll.DBQueryMode.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
dll.DBChangeMode.restype = ctypes.c_long
dll.DBChangeMode.argtypes = [ctypes.c_void_p, ctypes.c_int]
dll.DBRead.restype = ctypes.c_long

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
        ("szNo", ctypes.c_wchar * 512),
    ]
dll.DBRead.argtypes = [ctypes.c_void_p, ctypes.POINTER(DBDevInfo)]

print(f"Python bits: {ctypes.sizeof(ctypes.c_void_p) * 8}")
print()

# Step 1: DBInit
print("Step 1: DBInit()")
ok = dll.DBInit()
print(f"  -> {'OK' if ok else 'FAILED'}")
if not ok:
    sys.exit(1)

# Step 2: DBConnect with explicit rc
print("\nStep 2: DBConnectA(USB, 0x0203, ...)")
h = ctypes.c_void_p(0)
rc = dll.DBConnectA(b"USB", ctypes.c_uint16(0x0203), ctypes.byref(h))
print(f"  -> rc={rc}, handle={hex(h.value) if h.value else 'NULL'}")
if rc != 0 or not h.value:
    print(f"\n  rc meaning (from DataBuilder.h):")
    err_codes = {
        0: "OK",
        1: "DB_ERR_CONNECT_FULL", 2: "DB_ERR_INVALID_NAME", 3: "DB_ERR_LOAD_DLL",
        4: "DB_ERR_OPEN_PORT", 5: "DB_ERR_INVALID_HANDLE", 6: "DB_ERR_INVALID_MODE",
        44: "DB_ERR_INVALID_PLCID", 47: "DB_ERR_USBDLL_VERSION",
        -1: "DB_ERR_TIMEOUT", -2: "DB_ERR_RECEIVE_CAN", -3: "DB_ERR_RECEIVE_NAK",
        -12: "DB_ERR_REPS_LESS (unknown)", -14: "DB_ERR_USB_OPEN",
        -15: "DB_ERR_USB_WRITE", -16: "DB_ERR_USB_READ", -17: "DB_ERR_RECV_CMDCODE",
        -18: "DB_ERR_CPU_TYPE",
    }
    print(f"    rc={rc}: {err_codes.get(rc, '(unmapped)')}")
    sys.exit(1)

print("  CONNECTED OK")

# Step 3: Clear error + query mode
print("\nStep 3: DBKvClearError()")
rc = dll.DBKvClearError(h)
print(f"  -> rc={rc}")

print("\nStep 4: DBQueryMode()")
mode = ctypes.c_int(0)
rc = dll.DBQueryMode(h, ctypes.byref(mode))
print(f"  -> rc={rc}, mode={mode.value}  (1=RUN, 2=PROG, 0=INVALID)")

# Step 5: Try forcing RUN mode
if mode.value != 1:
    print("\nStep 5: DBChangeMode(RUN)")
    rc = dll.DBChangeMode(h, 1)
    print(f"  -> rc={rc}")

# Step 6: Try the simplest possible read - CR2002 (system relay always exists)
print("\nStep 6: DBRead CR2002 (kind=10, num=2002) - system control relay")
dev = DBDevInfo(); dev.wKind = 10; dev.dwNo = 2002
rc = dll.DBRead(h, ctypes.byref(dev))
print(f"  -> rc={rc}, value={dev.lValue}")

print("\nStep 7: DBRead MR0 (kind=12, num=0)")
dev = DBDevInfo(); dev.wKind = 12; dev.dwNo = 0
rc = dll.DBRead(h, ctypes.byref(dev))
print(f"  -> rc={rc}, value={dev.lValue}")

print("\nStep 8: DBRead DM0 (kind=18, num=0)")
dev = DBDevInfo(); dev.wKind = 18; dev.dwNo = 0
rc = dll.DBRead(h, ctypes.byref(dev))
print(f"  -> rc={rc}, value={dev.lValue}")

print("\nStep 9: DBRead MR807 (kind=12, num=807) -- user force-set to 1")
dev = DBDevInfo(); dev.wKind = 12; dev.dwNo = 807
rc = dll.DBRead(h, ctypes.byref(dev))
print(f"  -> rc={rc}, value={dev.lValue}  {'<-- ON' if dev.lValue else ''}")

print("\nStep 10: DBRead MR800-MR807")
for n in range(800, 808):
    dev = DBDevInfo(); dev.wKind = 12; dev.dwNo = n
    rc = dll.DBRead(h, ctypes.byref(dev))
    print(f"  MR{n} -> rc={rc}, value={dev.lValue}")

print("\nDisconnecting...")
dll.DBDisconnect(h)
print("Done.")
