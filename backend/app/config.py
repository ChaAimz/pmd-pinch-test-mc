from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class PlcDeviceMap(BaseModel):
    """Maps abstract addresses to (Keyence kind code, device number) pairs.

    YAML cannot represent tuple keys/values natively, so we store them as
    List[int] of length 2.  Code accesses them via helpers:
        kind, num = self.bits[addr]
    """

    # Bit addresses use the actual MR register number as the key.
    # kind=12 is KV3000_MR (Internal Auxiliary Relay).
    # Web→PLC bits are written by the backend; PLC→Web bits are polled/event-driven.
    bits: Dict[int, List[int]] = Field(default_factory=lambda: {
        # ── Web → PLC (commands) ──────────────────────────────────
        800: [12, 800],  # MR800  Start
        801: [12, 801],  # MR801  Stop / Software E-Stop
        802: [12, 802],  # MR802  Reset
        803: [12, 803],  # MR803  Check Clamp Force (Press Clamp)
        804: [12, 804],  # MR804  Clamp Stop
        101: [12, 101],  # MR101  Axis 1 Clear Alarm
        201: [12, 201],  # MR201  Axis 2 Clear Alarm
        502: [12, 502],  # MR502  Axis 3 Clear Alarm
        808: [12, 808],  # MR808  Tare ESP32 trigger (PLC→Web)
        810: [12, 810],  # MR810  ESP32 Force Limit Reached (Web→PLC, set by backend)
        812: [12, 812],  # MR812  Tare Imada (force gauge) trigger (PLC→Web)
        815: [12, 815],  # MR815  Imada Tension Limit Reached (Web→PLC, set by backend)
        # ── PLC → Web (status / events, polled) ──────────────────
        805: [12, 805],  # MR805  Start Tension Check
        806: [12, 806],  # MR806  End Loop Force-Gauge Check
        807: [12, 807],  # MR807  Finish All Loops
        809: [12, 809],  # MR809  Timer Start (PLC→Web — triggers UI countdown)
        811: [12, 811],  # MR811  Max Stroke of Clamp (PLC→Web, safety alarm)
        814: [12, 814],  # MR814  Loops Complete ack — PLC drives HIGH on finish; Web writes LOW to confirm
        3:   [12, 3],    # MR3    Emergency Stop (hardware)
        2:   [12, 2],    # MR2    Axis 3 Alarm
        100: [12, 100],  # MR100  Axis 1 Alarm
        200: [12, 200],  # MR200  Axis 2 Alarm
        300: [12, 300],  # MR300  Lamp Start  (Green)
        301: [12, 301],  # MR301  Lamp Stop   (Yellow)
        302: [12, 302],  # MR302  Lamp Reset  (Red)
        303: [12, 303],  # MR303  Machine Ready
    })
    # Word addresses -> [kind, num]
    words: Dict[int, List[int]] = Field(default_factory=lambda: {
        0:   [18, 28],   # loop count     -> DM28
        10:  [18, 10],   # heartbeat      -> DM10
        100: [18, 30],   # position       -> DM30 (mm × 100)
        102: [18, 32],   # speed          -> DM32 (mm/s × 100)
        103: [18, 36],   # OD diameter    -> DM36 (mm × 100)
        104: [18, 40],   # prepare timer  -> DM40 (sec × 10)
    })
    # Which MR addresses get polled (PLC→Web direction)
    poll_bit_addrs: List[int] = Field(default_factory=lambda: [
        805, 806, 807, 3,    # core state signals
        2, 100, 200,         # axis alarms (Axis3=MR2, Axis1=MR100, Axis2=MR200)
        300, 301, 302, 303,  # tower lamp status + machine ready
        808,                 # Tare ESP32 trigger (PLC can pulse this to tare)
        812,                 # Tare Imada trigger (PLC can pulse this to tare force gauge)
        804,                 # Clamp Stop — read back so UI reflects real PLC state
        803,                 # Press Clamp — PLC drives this; backend polls & waits for it
        809,                 # Timer Start — PLC drives this; triggers UI countdown
        811,                 # Max Stroke of Clamp — safety alarm (PLC→Web)
        814,                 # Loops Complete ack — PLC drives HIGH on finish; UI shows confirm dialog
    ])


class PlcConfig(BaseModel):
    enabled: bool = True
    connection: Literal["usb", "serial"] = "usb"
    # USB / bridge settings
    plc_id: int = 0x0203          # DBPLC_KV3000
    bridge_port: int = 8765
    bridge_python: str = "py32/python.exe"   # relative to backend/
    bridge_script: str = "plc_bridge.py"     # relative to backend/
    # Legacy serial fields (kept for compat; ignored in USB mode)
    port: str = "COM3"
    baud: int = 38400
    # Timing
    poll_interval_ms: int = 20
    heartbeat_interval_ms: int = 200
    # Device address map
    device_map: PlcDeviceMap = Field(default_factory=PlcDeviceMap)


class ImadaConfig(BaseModel):
    enabled: bool = True
    port: str = "COM5"
    baud: int = 19200
    decimal_format: bool = True
    # Imada ZT-series uses Remote/poll mode: host sends 'D\r', gauge replies once.
    # Measured ceiling on this rig ~130 Hz (round-trip USB-CDC at 19200 baud).
    # 13 ms = ~75 Hz gives 40% headroom under the ceiling and good resolution for tension peaks.
    poll_interval_ms: int = 13
    tension_limit_n: Optional[float] = Field(
        2.0, description="Tension limit in N during TENSION_CHECK; None = disabled"
    )


class Esp32Calibration(BaseModel):
    slope: float
    offset: float


class Esp32Config(BaseModel):
    enabled: bool = True
    port: str = "COM5"
    baud: int = 115200
    calibration: Esp32Calibration
    force_limit_gf: Optional[float] = Field(None, description="Force limit in gf; None = disabled")
    clamp_offset_gf: float = 0.0


class StateTimeouts(BaseModel):
    wait_clamp_press_ms: int = 30000   # wait for PLC to drive MR803 (Press Clamp)
    wait_clamp_force_ms: int = 100000
    wait_b5_ms: int = 30000
    tension_check_ms: int = 30000
    done_b7_ms: int = 30000
    tension_start_offset_ms: int = 50  # skip this many ms after MR805 before recording (mechanical delay)


class HardwareConfig(BaseModel):
    plc: PlcConfig
    imada: ImadaConfig
    esp32: Esp32Config
    state_timeouts: StateTimeouts = Field(default_factory=StateTimeouts)


class StorageConfig(BaseModel):
    db_url: str = "sqlite:///./pinch.db"
    waveforms_dir: str = "./waveforms"


class ServerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8000


class ExportConfig(BaseModel):
    # Windows' GetDriveTypeW reports DRIVE_REMOVABLE for genuine USB flash
    # drives AND for some permanently-attached USB hard disks/enclosures —
    # the OS has no clean way to tell them apart. List drive letters here
    # (e.g. ["D"]) that should never be treated as an export flash-drive
    # target, even if Windows reports them as removable.
    excluded_drive_letters: List[str] = Field(default_factory=list)


class Settings(BaseSettings):
    hardware: HardwareConfig
    storage: StorageConfig
    server: ServerConfig
    export: ExportConfig = Field(default_factory=ExportConfig)
    mock_mode: bool = True

    model_config = SettingsConfigDict(env_prefix="PINCH_", env_nested_delimiter="__")


def load_settings(path: Path | str) -> Settings:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    return Settings.model_validate(raw)
