"""
pinch_tray.py -- PySide6 system-tray manager for the Pinch Test Machine.

Architecture
------------
  Backend  : native uvicorn :8000  (COM ports + USB PLC; cannot containerize)
  Frontend : Docker container nginx :8080 (restart: always)
  Kiosk    : Edge --kiosk http://localhost:8080

Threading model
---------------
  Main thread  : Qt event loop (QApplication.exec())
  StartupWorker: QThread that drives the full launch sequence, emits Qt signals
                 back to the main thread for status updates and error dialogs.
  HealthWorker : QThread that polls backend health forever.
  docker-up    : plain daemon thread (subprocess, no Qt objects)

Path resolution (pinch-tray.ini beside the exe)
------------------------------------------------
  [pinch]
  backend_dir  = C:\\pinch-test-mc\\backend
  compose_file = C:\\pinch-test-mc\\docker-compose.yml

  Override via env vars PINCH_BACKEND_DIR / PINCH_COMPOSE_FILE.
  Fallback: ../backend  /  ../docker-compose.yml  (repo dev mode).

Auto-start
----------
  HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run
  name = PinchTestMachine
  data = "C:\\pinch-test-mc\\pinch-tray.exe"
"""

from __future__ import annotations

import configparser
import logging
import logging.handlers
import os
import subprocess
import sys
import threading
import time
import urllib.request
import winreg
from pathlib import Path
from typing import Optional

import psutil
from PySide6.QtCore import (
    QObject, QThread, QTimer, Signal, Slot, Qt,
)
from PySide6.QtGui import QIcon, QPixmap, QPainter, QColor, QFont, QAction
from PySide6.QtWidgets import (
    QApplication, QMenu, QMessageBox, QSystemTrayIcon,
    QWidget, QLabel, QVBoxLayout, QHBoxLayout, QProgressBar,
)

# ---------------------------------------------------------------------------
# Exe / script location
# ---------------------------------------------------------------------------

if getattr(sys, "frozen", False):
    _EXE_DIR = Path(sys.executable).parent
else:
    _EXE_DIR = Path(__file__).parent

_ASSETS = _EXE_DIR / "assets"

# ---------------------------------------------------------------------------
# INI + path resolution
# ---------------------------------------------------------------------------

_ini_path = _EXE_DIR / "pinch-tray.ini"
_ini = configparser.ConfigParser()
if _ini_path.exists():
    _ini.read(_ini_path, encoding="utf-8")


def _ini_get(key: str) -> str:
    return _ini.get("pinch", key, fallback="").strip()


def _resolve_backend_dir() -> Path:
    env = os.environ.get("PINCH_BACKEND_DIR", "").strip()
    if env:
        p = Path(env)
        if p.is_dir():
            return p.resolve()
    ini = _ini_get("backend_dir")
    if ini:
        p = Path(ini)
        if p.is_dir():
            return p.resolve()
    return (_EXE_DIR / ".." / "backend").resolve()


def _resolve_compose_file() -> Path:
    env = os.environ.get("PINCH_COMPOSE_FILE", "").strip()
    if env:
        return Path(env).resolve()
    ini = _ini_get("compose_file")
    if ini:
        return Path(ini).resolve()
    return (_EXE_DIR / ".." / "docker-compose.yml").resolve()


BACKEND_DIR         = _resolve_backend_dir()
BACKEND_EXE         = BACKEND_DIR / "pinch-backend.exe"   # bundled production binary
VENV_PY             = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
DOCKER_COMPOSE_FILE = _resolve_compose_file()

LOG_DIR      = BACKEND_DIR / "logs" if BACKEND_DIR.is_dir() else _EXE_DIR
LOG_FILE     = LOG_DIR / "tray.log"
APP_LOG_FILE = BACKEND_DIR / "logs" / "app.log"

_EDGE_CANDIDATES = [
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
    / "Microsoft" / "Edge" / "Application" / "msedge.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    / "Microsoft" / "Edge" / "Application" / "msedge.exe",
]
EDGE_EXE = next((p for p in _EDGE_CANDIDATES if p.exists()), None)
EDGE_PROFILE = (
    Path(os.environ.get("LOCALAPPDATA", r"C:\Users\Default\AppData\Local"))
    / "pinch-mc" / "edge"
)

KIOSK_URL           = "http://localhost:8080"
BACKEND_HEALTH_URL  = "http://127.0.0.1:8000/api/recipes"
FRONTEND_HEALTH_URL = "http://localhost:8080"

POLL_INTERVAL_S          = 2
BACKEND_START_TIMEOUT_S  = 90
DOCKER_ENGINE_TIMEOUT_S  = 90
FRONTEND_HEALTH_TIMEOUT_S = 120

# Windows subprocess flag -- suppress console window
_WIN_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

# Registry autostart
_REG_RUN_PATH  = r"Software\Microsoft\Windows\CurrentVersion\Run"
_REG_RUN_NAME  = "PinchTestMachine"
_REG_RUN_VALUE = str(_EXE_DIR / "pinch-tray.exe")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOG_DIR.mkdir(parents=True, exist_ok=True)

_rot = logging.handlers.RotatingFileHandler(
    LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
_rot.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
_con = logging.StreamHandler(sys.stdout)
_con.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

log = logging.getLogger("pinch_tray")
log.setLevel(logging.DEBUG)
log.addHandler(_rot)
log.addHandler(_con)

# ---------------------------------------------------------------------------
# Icons  (loaded from assets/ or generated in-memory as fallback)
# ---------------------------------------------------------------------------

_COLOUR_RUNNING  = "#10b981"   # emerald
_COLOUR_STARTING = "#f59e0b"   # amber
_COLOUR_STOPPED  = "#ef4444"   # red


def _asset(name: str) -> Path:
    return _ASSETS / name


def _qicon_from_file(filename: str) -> QIcon:
    p = _asset(filename)
    if p.exists():
        return QIcon(str(p))
    return QIcon()


def _make_tray_icon_fallback(hex_colour: str) -> QIcon:
    """Generate a 32x32 rounded-square 'P' icon in *hex_colour* as fallback."""
    px = QPixmap(32, 32)
    px.fill(Qt.transparent)
    painter = QPainter(px)
    painter.setRenderHint(QPainter.Antialiasing)
    colour = QColor(hex_colour)
    painter.setBrush(colour)
    painter.setPen(Qt.NoPen)
    painter.drawRoundedRect(2, 2, 28, 28, 6, 6)
    painter.setPen(QColor("white"))
    f = QFont("Arial", 16, QFont.Bold)
    painter.setFont(f)
    painter.drawText(px.rect(), Qt.AlignCenter, "P")
    painter.end()
    return QIcon(px)


def _load_state_icon(state: str) -> QIcon:
    """Load a state icon from assets, or generate fallback."""
    mapping = {
        "running":  ("icon_running.png",  _COLOUR_RUNNING),
        "starting": ("icon_starting.png", _COLOUR_STARTING),
        "stopped":  ("icon_stopped.png",  _COLOUR_STOPPED),
        "error":    ("icon_stopped.png",  _COLOUR_STOPPED),
    }
    filename, colour = mapping.get(state, ("icon_stopped.png", _COLOUR_STOPPED))
    icon = _qicon_from_file(filename)
    if icon.isNull():
        icon = _make_tray_icon_fallback(colour)
    return icon


def _load_splash_pixmap() -> QPixmap:
    p = _asset("logo_splash.png")
    if p.exists():
        return QPixmap(str(p))
    # Fallback: plain dark rectangle
    px = QPixmap(480, 160)
    px.fill(QColor("#0f172a"))
    painter = QPainter(px)
    painter.setPen(QColor("white"))
    f = QFont("Segoe UI", 18, QFont.Bold)
    painter.setFont(f)
    painter.drawText(px.rect(), Qt.AlignCenter, "Pinch Test Machine")
    painter.end()
    return px


# ---------------------------------------------------------------------------
# Registry autostart helpers
# ---------------------------------------------------------------------------

def _autostart_is_enabled() -> bool:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _REG_RUN_PATH) as k:
            winreg.QueryValueEx(k, _REG_RUN_NAME)
            return True
    except OSError:
        return False


def _autostart_enable() -> None:
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _REG_RUN_PATH, 0, winreg.KEY_SET_VALUE
        ) as k:
            winreg.SetValueEx(k, _REG_RUN_NAME, 0, winreg.REG_SZ, _REG_RUN_VALUE)
        log.info("Autostart enabled: HKCU Run -> %s", _REG_RUN_VALUE)
    except OSError as exc:
        log.error("Failed to write autostart registry key: %s", exc)
        return
    _remove_legacy_startup_shortcuts()


def _autostart_disable() -> None:
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _REG_RUN_PATH, 0, winreg.KEY_SET_VALUE
        ) as k:
            winreg.DeleteValue(k, _REG_RUN_NAME)
        log.info("Autostart disabled.")
    except FileNotFoundError:
        pass
    except OSError as exc:
        log.error("Failed to remove autostart registry key: %s", exc)


def _remove_legacy_startup_shortcuts() -> None:
    """Remove start-pinch*.bat/.lnk and 'Pinch Test Machine.lnk' from shell:startup."""
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return
    startup = os.path.join(appdata, r"Microsoft\Windows\Start Menu\Programs\Startup")
    if not os.path.isdir(startup):
        return
    patterns = ("start-pinch", "pinch test machine")
    for fname in os.listdir(startup):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in (".bat", ".lnk"):
            continue
        if any(fname.lower().startswith(p) for p in patterns):
            full = os.path.join(startup, fname)
            try:
                os.remove(full)
                log.info("Removed legacy startup shortcut: %s", full)
            except OSError as exc:
                log.warning("Could not remove %s: %s", full, exc)


# ---------------------------------------------------------------------------
# Low-level process helpers  (called from worker threads, no Qt objects)
# ---------------------------------------------------------------------------

def _kill_stray_bridge() -> None:
    killed = 0
    for proc in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmdline = " ".join(proc.info["cmdline"] or [])
            if "plc_bridge.py" in cmdline:
                log.info("Killing stray bridge pid=%d", proc.pid)
                proc.kill()
                killed += 1
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    if killed:
        log.info("Killed %d stray bridge(s); sleeping 3 s for USB release", killed)
        time.sleep(3)


def _kill_process_tree(proc: subprocess.Popen) -> None:
    try:
        parent = psutil.Process(proc.pid)
        children = parent.children(recursive=True)
        log.info("Killing backend tree: parent=%d children=%s",
                 proc.pid, [c.pid for c in children])
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
        parent.kill()
        proc.wait(timeout=5)
    except (psutil.NoSuchProcess, psutil.TimeoutExpired, ProcessLookupError):
        pass


def _url_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status < 500
    except Exception:
        return False


def _wait_for_url(url: str, timeout_s: float, label: str) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if _url_ok(url):
            log.info("%s ready at %s", label, url)
            return True
        time.sleep(POLL_INTERVAL_S)
    log.warning("%s did not respond within %.0f s at %s", label, timeout_s, url)
    return False


def _wait_for_docker_engine(timeout_s: float) -> bool:
    log.info("Waiting for Docker engine (up to %.0f s) ...", timeout_s)
    deadline = time.monotonic() + timeout_s
    warned = False
    while time.monotonic() < deadline:
        try:
            r = subprocess.run(
                ["docker", "info"], capture_output=True,
                timeout=5, creationflags=_WIN_FLAGS,
            )
            if r.returncode == 0:
                log.info("Docker engine ready.")
                return True
        except FileNotFoundError:
            if not warned:
                log.warning("docker CLI not found -- is Docker Desktop installed?")
                warned = True
            return False
        except subprocess.TimeoutExpired:
            pass
        except Exception as exc:
            log.debug("docker info probe: %s", exc)
        time.sleep(POLL_INTERVAL_S)
    log.warning("Docker engine not ready within %.0f s.", timeout_s)
    return False


def _ensure_frontend_container(compose_file: Path) -> None:
    """Best-effort: docker compose up -d frontend. Runs in a plain daemon thread."""
    if not compose_file.exists():
        log.warning("docker-compose.yml not found at %s -- skipping", compose_file)
        return
    if not _wait_for_docker_engine(DOCKER_ENGINE_TIMEOUT_S):
        log.warning("Docker engine not ready -- skipping docker compose up.")
        return
    log.info("Running: docker compose up -d frontend")
    try:
        result = subprocess.run(
            ["docker", "compose", "-f", str(compose_file), "up", "-d", "frontend"],
            capture_output=True, text=True, timeout=120,
            creationflags=_WIN_FLAGS,
        )
        if result.returncode == 0:
            log.info("docker compose up -d frontend: OK")
        else:
            log.warning("docker compose up returned %d\nstderr: %s",
                        result.returncode, result.stderr[:500])
    except subprocess.TimeoutExpired:
        log.warning("docker compose up timed out -- container may still be starting")
    except Exception as exc:
        log.warning("docker compose up failed: %s", exc)


# ---------------------------------------------------------------------------
# Splash window
# ---------------------------------------------------------------------------

class SplashWindow(QWidget):
    """Frameless, topmost splash shown during the startup sequence."""

    def __init__(self) -> None:
        super().__init__()
        self.setWindowFlags(
            Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | Qt.SplashScreen
        )
        self.setAttribute(Qt.WA_TranslucentBackground, False)

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # Inner widget with dark background
        inner = QWidget()
        inner.setStyleSheet("""
            QWidget {
                background-color: #0f172a;
                border-radius: 12px;
            }
        """)
        inner_layout = QVBoxLayout(inner)
        inner_layout.setContentsMargins(24, 24, 24, 20)
        inner_layout.setSpacing(8)

        # Logo + title row
        header = QHBoxLayout()

        logo_label = QLabel()
        splash_px = _load_splash_pixmap()
        if not splash_px.isNull():
            # Use just the left portion (the badge) as the small logo
            logo_label.setPixmap(splash_px.scaled(80, 80, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        header.addWidget(logo_label)
        header.addSpacing(16)

        title_col = QVBoxLayout()
        title_col.setSpacing(2)

        lbl_title = QLabel("Pinch Test Machine")
        lbl_title.setStyleSheet("color: #f8fafc; font-size: 20px; font-weight: bold;"
                                " background: transparent;")
        title_col.addWidget(lbl_title)

        lbl_sub = QLabel("Industrial Control System")
        lbl_sub.setStyleSheet("color: #64748b; font-size: 11px; background: transparent;")
        title_col.addWidget(lbl_sub)

        title_col.addStretch()
        header.addLayout(title_col)
        header.addStretch()
        inner_layout.addLayout(header)

        inner_layout.addSpacing(12)

        # Status line
        self._status_lbl = QLabel("Initialising...")
        self._status_lbl.setStyleSheet("color: #94a3b8; font-size: 11px;"
                                       " background: transparent;")
        inner_layout.addWidget(self._status_lbl)

        # Progress bar
        self._bar = QProgressBar()
        self._bar.setRange(0, 0)   # indeterminate
        self._bar.setTextVisible(False)
        self._bar.setFixedHeight(6)
        self._bar.setStyleSheet("""
            QProgressBar {
                background-color: #1e293b;
                border: none;
                border-radius: 3px;
            }
            QProgressBar::chunk {
                background-color: #3b82f6;
                border-radius: 3px;
            }
        """)
        inner_layout.addWidget(self._bar)

        root_layout.addWidget(inner)

        self.setFixedSize(420, 180)
        self._centre()

    def _centre(self) -> None:
        screen = QApplication.primaryScreen().geometry()
        x = (screen.width()  - self.width())  // 2
        y = (screen.height() - self.height()) // 2
        self.move(x, y)

    @Slot(str)
    def set_status(self, text: str) -> None:
        self._status_lbl.setText(text)


# ---------------------------------------------------------------------------
# StartupWorker  (QThread)
# ---------------------------------------------------------------------------

class StartupWorker(QThread):
    """Drives the full startup sequence off the Qt main thread.

    Signals (all connected to GUI-thread slots):
        statusChanged(str)          -- update splash status line
        errorOccurred(str, str)     -- show error dialog (title, message)
        warnOccurred(str, str)      -- show warning dialog
        finished_ok()               -- startup succeeded; close splash + open kiosk
        finished_fail()             -- startup failed; close splash (error already shown)
    """

    statusChanged  = Signal(str)
    errorOccurred  = Signal(str, str)
    warnOccurred   = Signal(str, str)
    finished_ok    = Signal()
    finished_fail  = Signal()

    def __init__(
        self,
        backend_proc_holder: "BackendProcHolder",
        parent: Optional[QObject] = None,
    ) -> None:
        super().__init__(parent)
        self._holder = backend_proc_holder

    def run(self) -> None:
        # --- Validate install ---
        if not BACKEND_DIR.is_dir():
            msg = (
                f"Backend directory not found:\n{BACKEND_DIR}\n\n"
                "Run assemble-standalone.ps1 to create the installation."
            )
            self.errorOccurred.emit("Backend not found", msg)
            self.finished_fail.emit()
            return

        # Accept either bundled exe (production) or venv python (dev/repo)
        if not BACKEND_EXE.exists() and not VENV_PY.exists():
            msg = (
                "Neither the bundled backend nor the venv Python was found:\n\n"
                f"  {BACKEND_EXE}\n"
                f"  {VENV_PY}\n\n"
                "Run assemble-standalone.ps1 to create the installation, or\n"
                "set up the backend venv in dev mode."
            )
            self.errorOccurred.emit("Backend not found", msg)
            self.finished_fail.emit()
            return

        # --- Docker frontend (daemon thread, parallel) ---
        self.statusChanged.emit("Starting Docker frontend container...")
        docker_thread = threading.Thread(
            target=_ensure_frontend_container,
            args=(DOCKER_COMPOSE_FILE,),
            daemon=True, name="docker-up",
        )
        docker_thread.start()

        # --- Start backend ---
        mode = "pinch-backend.exe" if BACKEND_EXE.exists() else "uvicorn (venv)"
        self.statusChanged.emit(f"Starting backend ({mode}) ...")
        ok = self._holder.start_backend()
        if not ok:
            # Error signal already emitted by start_backend
            self.finished_fail.emit()
            # Still open the kiosk so the screen is not blank
            self._open_kiosk()
            return

        # --- Wait for docker thread ---
        self.statusChanged.emit("Waiting for frontend container (:8080)...")
        docker_thread.join(timeout=DOCKER_ENGINE_TIMEOUT_S)
        if docker_thread.is_alive():
            log.warning("docker-up thread still running after %.0f s", DOCKER_ENGINE_TIMEOUT_S)

        # --- Poll frontend ---
        self.statusChanged.emit("Waiting for http://localhost:8080 ...")
        frontend_ok = _wait_for_url(
            FRONTEND_HEALTH_URL, FRONTEND_HEALTH_TIMEOUT_S, "Frontend"
        )
        if not frontend_ok:
            msg = (
                f"The frontend container at {FRONTEND_HEALTH_URL} did not respond "
                f"within {FRONTEND_HEALTH_TIMEOUT_S:.0f} s.\n\n"
                "The browser will open now. If the page is blank, wait a moment "
                "and refresh, or check:\n  docker compose logs frontend\n\n"
                f"Tray log: {LOG_FILE}"
            )
            self.warnOccurred.emit("Frontend slow to start", msg)

        # --- Open kiosk ---
        self.statusChanged.emit("Opening kiosk...")
        self._open_kiosk()

        self.finished_ok.emit()

    def _open_kiosk(self) -> None:
        if EDGE_EXE is None:
            log.warning("msedge.exe not found -- navigate to %s manually.", KIOSK_URL)
            return
        EDGE_PROFILE.mkdir(parents=True, exist_ok=True)
        cmd = [
            str(EDGE_EXE),
            f"--kiosk={KIOSK_URL}",
            "--edge-kiosk-type=fullscreen",
            "--disable-pinch",
            "--overscroll-history-navigation=0",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "--disable-features=ExtensionsToolbarMenu,InfiniteSessionRestore,TranslateUI",
            f"--user-data-dir={EDGE_PROFILE}",
            "--hide-crash-restore-bubble",
        ]
        log.info("Launching Edge kiosk: %s", KIOSK_URL)
        subprocess.Popen(cmd, creationflags=_WIN_FLAGS)


# ---------------------------------------------------------------------------
# HealthWorker  (QThread)
# ---------------------------------------------------------------------------

class HealthWorker(QThread):
    """Continuously polls backend health and emits state-change signals."""

    stateChanged    = Signal(str)   # "running" | "unhealthy" | "crashed"
    crashDetected   = Signal(str, str)  # title, message (crash error)

    def __init__(
        self,
        backend_proc_holder: "BackendProcHolder",
        parent: Optional[QObject] = None,
    ) -> None:
        super().__init__(parent)
        self._holder = backend_proc_holder
        self._running = True

    def stop(self) -> None:
        self._running = False

    def run(self) -> None:
        # Grace period -- let startup finish before we start judging
        time.sleep(POLL_INTERVAL_S * 3)
        _unhealthy = 0
        _THRESH = 3

        while self._running:
            time.sleep(POLL_INTERVAL_S)
            proc = self._holder.proc
            is_alive = proc is not None and proc.poll() is None

            if is_alive:
                if _url_ok(BACKEND_HEALTH_URL):
                    _unhealthy = 0
                    self.stateChanged.emit("running")
                else:
                    _unhealthy += 1
                    self.stateChanged.emit("unhealthy")
                    if _unhealthy >= _THRESH and not self._holder.user_stopped:
                        msg = (
                            "The backend process is running but stopped responding.\n\n"
                            f"URL: {BACKEND_HEALTH_URL}\n"
                            f"See: {APP_LOG_FILE}\n\n"
                            "Use 'Reset' from the tray menu to restart it."
                        )
                        self.crashDetected.emit("Backend not responding", msg)
                        _unhealthy = 0
            else:
                _unhealthy = 0
                if not self._holder.user_stopped and self._holder.was_running:
                    exit_code = proc.poll() if proc is not None else "?"
                    msg = (
                        f"The backend stopped unexpectedly (exit code: {exit_code}).\n\n"
                        f"See: {APP_LOG_FILE}\n\n"
                        "Use 'Start' or 'Reset' from the tray menu to restart it."
                    )
                    self.crashDetected.emit("Backend stopped unexpectedly", msg)
                    self._holder.was_running = False
                self.stateChanged.emit("stopped")


# ---------------------------------------------------------------------------
# BackendProcHolder  (plain object, accessed from multiple threads with a lock)
# ---------------------------------------------------------------------------

class BackendProcHolder:
    """Thread-safe container for the backend subprocess + user-stop flag."""

    def __init__(self, error_signal: Signal) -> None:
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen] = None
        self.user_stopped: bool = False
        self.was_running: bool = False      # True once backend reached healthy state
        self._error_signal = error_signal   # Signal(str, str) -- emits on startup fail

    @property
    def proc(self) -> Optional[subprocess.Popen]:
        with self._lock:
            return self._proc

    def start_backend(self) -> bool:
        """Kill stray bridge, launch backend, poll until healthy. Thread-safe.

        Launch order:
          1. If <backend_dir>/pinch-backend.exe exists → use bundled binary
             (production / source-protected path).
          2. Else fall back to venv python -m uvicorn (dev / repo mode).
          3. If neither exists → emit error and return False.
        """
        with self._lock:
            if self._proc and self._proc.poll() is None:
                log.info("Backend already running (pid=%d)", self._proc.pid)
                return True
            log.info("Killing stray bridges ...")
            _kill_stray_bridge()
            self.user_stopped = False

            if BACKEND_EXE.exists():
                log.info("Launching bundled backend: %s", BACKEND_EXE)
                cmd = [str(BACKEND_EXE)]
                launch_label = "pinch-backend.exe"
            elif VENV_PY.exists():
                log.info("Launching uvicorn via venv: %s", VENV_PY)
                cmd = [
                    str(VENV_PY), "-m", "uvicorn",
                    "app.main:app", "--port", "8000", "--host", "127.0.0.1",
                ]
                launch_label = "uvicorn (venv)"
            else:
                msg = (
                    f"Backend not found in:\n"
                    f"  {BACKEND_EXE}\n"
                    f"  {VENV_PY}\n\n"
                    "Run assemble-standalone.ps1 to create the installation."
                )
                self._error_signal.emit("Backend not found", msg)
                return False

            log.info("Starting %s ...", launch_label)
            self._proc = subprocess.Popen(
                cmd,
                cwd=str(BACKEND_DIR),
                creationflags=_WIN_FLAGS,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            log.info("Backend pid=%d; polling health ...", self._proc.pid)

        threading.Thread(target=self._drain_stdout, daemon=True).start()

        # Poll with early-exit on process death
        deadline = time.monotonic() + BACKEND_START_TIMEOUT_S
        while time.monotonic() < deadline:
            with self._lock:
                proc = self._proc
            if proc is not None and proc.poll() is not None:
                msg = (
                    f"Backend process exited during startup "
                    f"(exit code {proc.poll()}).\n\n"
                    "Check config.yaml and see:\n"
                    f"  {APP_LOG_FILE}"
                )
                self._error_signal.emit("Backend startup failed", msg)
                return False
            if _url_ok(BACKEND_HEALTH_URL):
                log.info("Backend is ready.")
                self.was_running = True
                return True
            time.sleep(POLL_INTERVAL_S)

        msg = (
            f"Backend did not respond within {BACKEND_START_TIMEOUT_S} s.\n\n"
            "Check:\n"
            "  - config.yaml (COM ports, mock_mode)\n"
            "  - pinch-backend.exe or venv intact\n"
            "  - port 8000 not in use\n\n"
            f"See: {APP_LOG_FILE}"
        )
        self._error_signal.emit("Backend failed to start", msg)
        return False

    def stop_backend(self) -> None:
        """User-initiated stop. Sets user_stopped before killing."""
        self.user_stopped = True
        with self._lock:
            proc = self._proc
            if proc is None:
                return
            if proc.poll() is not None:
                self._proc = None
                return
            log.info("Stopping backend (pid=%d) + children ...", proc.pid)
            _kill_process_tree(proc)
            self._proc = None
        _kill_stray_bridge()

    def _drain_stdout(self) -> None:
        with self._lock:
            proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            for raw in proc.stdout:
                try:
                    log.debug("[uvicorn] %s", raw.decode("utf-8", errors="replace").rstrip())
                except Exception:
                    pass
        except Exception:
            pass


# ---------------------------------------------------------------------------
# TrayApp
# ---------------------------------------------------------------------------

class TrayApp(QObject):
    """Root Qt object. Owns the system tray, splash, workers, and menu."""

    # Internal signal used to safely route errors from worker threads to GUI
    _errorSignal = Signal(str, str)
    _warnSignal  = Signal(str, str)

    def __init__(self) -> None:
        super().__init__()
        self._last_error: Optional[tuple] = None
        self._tray_state = "starting"   # "running" | "starting" | "stopped" | "error"

        # BackendProcHolder wires the error signal back into Qt
        self._holder = BackendProcHolder(self._errorSignal)
        self._errorSignal.connect(self._on_error)
        self._warnSignal.connect(self._on_warn)

        # Build tray icon
        self._tray = QSystemTrayIcon(self)
        self._set_tray_state("starting")
        self._tray.setToolTip("Pinch Test Machine -- Starting...")
        self._tray.activated.connect(self._on_tray_activated)

        # Build menu
        self._menu = self._build_menu()
        self._tray.setContextMenu(self._menu)
        self._tray.show()

        # Splash
        self._splash: Optional[SplashWindow] = None
        self._show_splash()

        # Workers
        self._startup_worker = StartupWorker(self._holder, self)
        self._startup_worker.statusChanged.connect(self._on_status_changed)
        self._startup_worker.errorOccurred.connect(self._on_error)
        self._startup_worker.warnOccurred.connect(self._on_warn)
        self._startup_worker.finished_ok.connect(self._on_startup_ok)
        self._startup_worker.finished_fail.connect(self._on_startup_fail)
        self._startup_worker.start()

        self._health_worker = HealthWorker(self._holder, self)
        self._health_worker.stateChanged.connect(self._on_health_state)
        self._health_worker.crashDetected.connect(self._on_error)
        self._health_worker.start()

        # On first launch, remove legacy Startup shortcuts if autostart is active
        if _autostart_is_enabled():
            _remove_legacy_startup_shortcuts()

    # ------------------------------------------------------------------
    # Splash
    # ------------------------------------------------------------------

    def _show_splash(self) -> None:
        self._splash = SplashWindow()
        self._splash.show()

    def _close_splash(self) -> None:
        if self._splash is not None:
            self._splash.close()
            self._splash = None

    # ------------------------------------------------------------------
    # Tray state
    # ------------------------------------------------------------------

    def _set_tray_state(self, state: str) -> None:
        self._tray_state = state
        self._tray.setIcon(_load_state_icon(state))
        labels = {
            "running":  "Running",
            "starting": "Starting...",
            "stopped":  "Stopped",
            "unhealthy": "Unhealthy",
            "error":    "Error",
        }
        label = labels.get(state, state.capitalize())
        self._tray.setToolTip(
            f"Pinch Test Machine -- {label}\n{BACKEND_HEALTH_URL}"
        )
        self._update_menu_state()

    def _update_menu_state(self) -> None:
        """Enable/disable Start/Stop/Reset based on current state."""
        running = self._tray_state == "running"
        stopped = self._tray_state in ("stopped", "error")
        self._act_start.setEnabled(stopped)
        self._act_stop.setEnabled(running or self._tray_state == "unhealthy")
        self._act_reset.setEnabled(True)
        # Update header status dot
        colour_map = {
            "running":   "#10b981",
            "starting":  "#f59e0b",
            "stopped":   "#ef4444",
            "unhealthy": "#f59e0b",
            "error":     "#ef4444",
        }
        dot_colour = colour_map.get(self._tray_state, "#94a3b8")
        label_map = {
            "running":   "Running",
            "starting":  "Starting...",
            "stopped":   "Stopped",
            "unhealthy": "Unhealthy",
            "error":     "Error",
        }
        dot = "●"   # filled circle
        self._act_status_detail.setText(
            f"  {dot} {label_map.get(self._tray_state, self._tray_state)}"
        )
        self._act_status_detail.setStyleSheet(f"color: {dot_colour};")
        # Autostart checkbox
        self._act_autostart.setChecked(_autostart_is_enabled())

    # ------------------------------------------------------------------
    # Menu construction
    # ------------------------------------------------------------------

    def _build_menu(self) -> QMenu:
        menu = QMenu()

        # --- Header (non-interactive) ---
        act_header = QAction("Pinch Test Machine", self)
        act_header.setEnabled(False)
        f = act_header.font()
        f.setBold(True)
        act_header.setFont(f)
        menu.addAction(act_header)

        self._act_status_detail = QAction("  ● Starting...", self)
        self._act_status_detail.setEnabled(False)
        menu.addAction(self._act_status_detail)

        menu.addSeparator()

        # --- Backend controls ---
        self._act_start = QAction("Start", self)
        self._act_start.triggered.connect(self._on_start)
        menu.addAction(self._act_start)

        self._act_stop = QAction("Stop", self)
        self._act_stop.triggered.connect(self._on_stop)
        menu.addAction(self._act_stop)

        self._act_reset = QAction("Reset  (stop + start)", self)
        self._act_reset.triggered.connect(self._on_reset)
        menu.addAction(self._act_reset)

        menu.addSeparator()

        # --- Kiosk ---
        act_kiosk = QAction("Open Kiosk", self)
        act_kiosk.triggered.connect(self._on_open_kiosk)
        menu.addAction(act_kiosk)

        # --- Last error ---
        act_last_err = QAction("Show last error", self)
        act_last_err.triggered.connect(self._on_show_last_error)
        menu.addAction(act_last_err)

        menu.addSeparator()

        # --- Autostart (checkable) ---
        self._act_autostart = QAction("Auto Start with Windows", self)
        self._act_autostart.setCheckable(True)
        self._act_autostart.setChecked(_autostart_is_enabled())
        self._act_autostart.triggered.connect(self._on_toggle_autostart)
        menu.addAction(self._act_autostart)

        menu.addSeparator()

        # --- Quit ---
        act_quit = QAction("Quit", self)
        act_quit.triggered.connect(self._on_quit)
        menu.addAction(act_quit)

        self._update_menu_state()
        return menu

    # ------------------------------------------------------------------
    # Slots -- startup worker
    # ------------------------------------------------------------------

    @Slot(str)
    def _on_status_changed(self, text: str) -> None:
        if self._splash:
            self._splash.set_status(text)

    @Slot()
    def _on_startup_ok(self) -> None:
        self._close_splash()
        self._set_tray_state("running")

    @Slot()
    def _on_startup_fail(self) -> None:
        self._close_splash()
        self._set_tray_state("error")

    # ------------------------------------------------------------------
    # Slots -- health worker
    # ------------------------------------------------------------------

    @Slot(str)
    def _on_health_state(self, state: str) -> None:
        if self._tray_state in ("starting",):
            return   # don't override while startup is in progress
        if state == "running":
            self._set_tray_state("running")
        elif state == "unhealthy":
            self._set_tray_state("unhealthy")
        elif state == "stopped":
            if self._tray_state not in ("error", "starting"):
                self._set_tray_state("stopped")

    # ------------------------------------------------------------------
    # Slots -- error / warn
    # ------------------------------------------------------------------

    @Slot(str, str)
    def _on_error(self, title: str, message: str) -> None:
        log.error("[ERROR] %s: %s", title, message)
        self._last_error = (title, message)
        self._set_tray_state("error")
        if self._tray.isSystemTrayAvailable():
            self._tray.showMessage(title, message[:200], QSystemTrayIcon.Critical, 5000)
        self._show_msgbox(title, message, error=True)

    @Slot(str, str)
    def _on_warn(self, title: str, message: str) -> None:
        log.warning("[WARN] %s: %s", title, message)
        if self._tray.isSystemTrayAvailable():
            self._tray.showMessage(title, message[:200], QSystemTrayIcon.Warning, 5000)
        self._show_msgbox(title, message, error=False)

    def _show_msgbox(self, title: str, message: str, error: bool = True) -> None:
        box = QMessageBox()
        box.setWindowTitle(title)
        box.setText(message)
        box.setIcon(QMessageBox.Critical if error else QMessageBox.Warning)
        # Stay on top of the fullscreen kiosk
        box.setWindowFlags(
            box.windowFlags()
            | Qt.WindowStaysOnTopHint
            | Qt.Dialog
        )
        box.setWindowIcon(_load_state_icon("error"))
        box.exec()

    # ------------------------------------------------------------------
    # Tray menu action slots
    # ------------------------------------------------------------------

    @Slot()
    def _on_start(self) -> None:
        self._set_tray_state("starting")
        threading.Thread(target=self._holder.start_backend, daemon=True).start()

    @Slot()
    def _on_stop(self) -> None:
        threading.Thread(target=self._holder.stop_backend, daemon=True).start()
        self._set_tray_state("stopped")

    @Slot()
    def _on_reset(self) -> None:
        def _do() -> None:
            self._holder.stop_backend()
            time.sleep(2)
            self._holder.start_backend()
        self._set_tray_state("starting")
        threading.Thread(target=_do, daemon=True).start()

    @Slot()
    def _on_open_kiosk(self) -> None:
        if EDGE_EXE is None:
            self._on_warn("Edge not found",
                          f"msedge.exe not found. Navigate to {KIOSK_URL} manually.")
            return
        EDGE_PROFILE.mkdir(parents=True, exist_ok=True)
        cmd = [
            str(EDGE_EXE),
            f"--kiosk={KIOSK_URL}",
            "--edge-kiosk-type=fullscreen",
            "--disable-pinch",
            "--overscroll-history-navigation=0",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "--disable-features=ExtensionsToolbarMenu,InfiniteSessionRestore,TranslateUI",
            f"--user-data-dir={EDGE_PROFILE}",
            "--hide-crash-restore-bubble",
        ]
        subprocess.Popen(cmd, creationflags=_WIN_FLAGS)

    @Slot()
    def _on_show_last_error(self) -> None:
        if self._last_error is None:
            self._show_msgbox("No errors", "No errors recorded in this session.", error=False)
        else:
            title, msg = self._last_error
            self._show_msgbox(f"[Last error] {title}", msg, error=True)

    @Slot()
    def _on_toggle_autostart(self) -> None:
        if _autostart_is_enabled():
            _autostart_disable()
        else:
            _autostart_enable()
        self._act_autostart.setChecked(_autostart_is_enabled())

    @Slot(QSystemTrayIcon.ActivationReason)
    def _on_tray_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.DoubleClick:
            self._on_open_kiosk()

    @Slot()
    def _on_quit(self) -> None:
        log.info("Quit requested.")
        self._health_worker.stop()
        self._health_worker.quit()
        self._health_worker.wait(2000)
        self._holder.stop_backend()
        self._close_splash()
        QApplication.quit()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    # High-DPI support
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)   # keep running after splash closes

    # App metadata
    app.setApplicationName("Pinch Test Machine")
    app.setApplicationDisplayName("Pinch Test Machine")
    app.setOrganizationName("PMD")

    # App-wide icon
    ico_path = _asset("icon.ico")
    if ico_path.exists():
        app.setWindowIcon(QIcon(str(ico_path)))

    if not QSystemTrayIcon.isSystemTrayAvailable():
        log.error("System tray not available on this desktop.")
        # Still launch kiosk even without tray
        tray_app = TrayApp()
    else:
        tray_app = TrayApp()

    log.info(
        "=== Pinch Tray (PySide6) starting | exe_dir=%s | backend=%s ===",
        _EXE_DIR, BACKEND_DIR,
    )

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
