"""
run_backend.py -- Production entry point for pinch-backend.exe (PyInstaller onefile).

When frozen, this script is the __main__ module.  It builds the FastAPI app
(which reads config.yaml from CWD) and starts uvicorn in-process.

CWD contract
------------
The tray launches pinch-backend.exe with cwd=<backend_dir>.  Both
config.yaml and the data/ directory resolve relative to CWD, which is
how app/main.py already works in dev mode (load_settings reads "config.yaml"
as a relative Path).  Do NOT hardcode any absolute path here.

No --reload.  No CLI args.  The port and host are fixed for the single-machine
production deployment.
"""
from __future__ import annotations

import sys

# PyInstaller sets sys.frozen=True and adds the _MEIPASS temp dir to sys.path.
# All bundled packages are importable from there; nothing else is needed here.

import uvicorn


def main() -> None:
    # build_app() reads load_settings(Path("config.yaml")) — relative to CWD.
    # At runtime CWD is C:\pinch-test-mc\backend (set by the tray).
    # Import here (not at module level) so we only pay the SQLModel/FastAPI init
    # cost once uvicorn starts, not during PyInstaller analysis.
    from app.main import build_app

    application = build_app()

    uvicorn.run(
        application,
        host="127.0.0.1",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
