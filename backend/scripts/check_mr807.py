"""Check MR807 (user force-set to 1) via the running bridge."""
import urllib.request, json

def post(path, body):
    req = urllib.request.Request(
        "http://127.0.0.1:8765" + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())

print("Reading MR800-MR807 from bridge:")
for n in range(800, 808):
    r = post("/read_bit", {"kind": 12, "num": n})
    marker = "  <-- ON" if r.get("value") else ""
    print(f"  MR{n}: {r}{marker}")
