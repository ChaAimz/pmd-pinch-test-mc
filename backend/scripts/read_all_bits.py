"""Stop polling+heartbeat, then try a clean read to see if it's the threads interfering."""
import urllib.request
import json
import time

BRIDGE = "http://127.0.0.1:8765"

def post(path, body):
    req = urllib.request.Request(
        BRIDGE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=3) as r:
        return json.loads(r.read())

print("BEFORE — bridge status:", json.dumps(json.loads(urllib.request.urlopen(BRIDGE + "/status", timeout=3).read())))

print("Stopping polling + heartbeat...")
print(" stop_polling:   ", post("/stop_polling", {}))
print(" stop_heartbeat: ", post("/stop_heartbeat", {}))
time.sleep(0.5)

print()
print("AFTER stop — read attempts:")
print(" DM0 :", post("/read_word", {"kind": 18, "num": 0}))
print(" MR0 :", post("/read_bit",  {"kind": 12, "num": 0}))
print(" MR4000:", post("/read_bit",  {"kind": 12, "num": 4000}))

print()
print("Status now:", json.dumps(json.loads(urllib.request.urlopen(BRIDGE + "/status", timeout=3).read())))
