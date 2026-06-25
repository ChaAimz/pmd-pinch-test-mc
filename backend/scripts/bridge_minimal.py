"""Test the bridge with NO polling/heartbeat — just connect + read."""
import urllib.request
import json
import time

BRIDGE = "http://127.0.0.1:8765"

def post(path, body=None):
    req = urllib.request.Request(
        BRIDGE + path,
        data=json.dumps(body or {}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def get(path):
    with urllib.request.urlopen(BRIDGE + path, timeout=3) as r:
        return json.loads(r.read())

# Wait for bridge to be ready
for _ in range(15):
    try:
        s = get("/status")
        break
    except Exception:
        time.sleep(0.5)

print("Initial status:", get("/status"))

# Step 1: connect
print("\n1) /connect:", post("/connect", {"plc_id": 0x0203, "dest": "USB"}))

# Step 2: immediately read - NO polling, NO heartbeat started yet
print("\n2) Read DM0:    ", post("/read_word", {"kind": 18, "num": 0}))
print("   Read MR0:    ", post("/read_bit",  {"kind": 12, "num": 0}))
print("   Read MR4000: ", post("/read_bit",  {"kind": 12, "num": 4000}))
print("   Read CR2002 (system, kind=10):", post("/read_word", {"kind": 10, "num": 2002}))

# Step 3: try write
print("\n3) Write DM0=5555:", post("/write_word", {"kind": 18, "num": 0, "value": 5555}))
print("   Read DM0 back:  ", post("/read_word",  {"kind": 18, "num": 0}))
