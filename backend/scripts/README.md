# backend/scripts

One-shot diagnostic and sanity scripts. **Not** part of the pytest suite — they talk to real hardware.

| Script | What it does | How to run |
|---|---|---|
| `smoke_test_plc.py` | End-to-end check of `RealPlc`: spawn bridge subprocess, connect over USB, write/read MR0 (B0) and DM100 (W100), listen for edge events 2 s, disconnect. | `.venv\Scripts\python.exe scripts\smoke_test_plc.py` (from `backend/`) |
| `smoke_test_imada.py` | End-to-end check of `RealImada`: open COM port, listen to continuous ASCII stream for N seconds, print parsed samples + min/max/rate. **Close Force Logger first** (only one app can hold a COM port). | `.venv\Scripts\python.exe scripts\smoke_test_imada.py --port COM4 --seconds 5` (from `backend/`) |
| `benchmark_plc_usb.py` | Measures raw `DataBuilder.dll` latency: single read, batch monitor (3 bits), `DBReadArea` (16 words), single write. Useful when tuning poll cadence. | `py32\python.exe scripts\benchmark_plc_usb.py` (from `backend/`) |

## Prerequisites

- KV-3000 powered on and connected via USB (Keyence KV USB driver installed — comes with KV STUDIO / KVComPlus)
- `backend/py32/` exists (32-bit embedded Python; see `plc_bridge.py` for why)
- `KVComPlusLB` installed at the default path `C:\Program Files (x86)\KEYENCE\KVComPlusLB\`

## Expected baseline (from `benchmark_plc_usb.py`)

```
Single DBRead         ~0.57 ms/call  (1700+ reads/sec)
Monitor batch (3 bits) ~0.51 ms/call  (1900+ polls/sec)
DBReadArea (16 words)  ~0.53 ms/call
Single DBWrite         ~0.46 ms/call  (2100+ writes/sec)
```

If `smoke_test_plc.py` hangs at "connecting ...", check that the USB cable is in, no other Keyence app (KV STUDIO) has the PLC open, and the PLC is powered.
