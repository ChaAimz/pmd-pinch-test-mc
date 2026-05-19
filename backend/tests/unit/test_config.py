import textwrap
from pathlib import Path

import pytest

from app.config import Settings, load_settings


def test_load_settings_from_yaml(tmp_path: Path):
    yaml_text = textwrap.dedent(
        """
        hardware:
          plc:
            enabled: true
            port: "COM10"
            baud: 38400
            poll_bits: [5, 6, 7]
            poll_interval_ms: 20
            heartbeat_word: 10
            heartbeat_interval_ms: 200
          imada:
            enabled: true
            port: "COM11"
            baud: 19200
            decimal_format: true
          esp32:
            enabled: true
            port: "COM12"
            baud: 115200
            calibration:
              slope: 0.01
              offset: 0.0
          state_timeouts:
            wait_clamp_force_ms: 5000
            wait_b5_ms: 30000
            tension_check_ms: 30000
            done_b7_ms: 30000
        mock_mode: true
        storage:
          db_url: "sqlite:///./test.db"
          waveforms_dir: "./wf"
        server:
          host: "127.0.0.1"
          port: 8000
        """
    ).strip()
    cfg = tmp_path / "config.yaml"
    cfg.write_text(yaml_text, encoding="utf-8")

    settings: Settings = load_settings(cfg)

    assert settings.mock_mode is True
    assert settings.hardware.plc.port == "COM10"
    assert settings.hardware.imada.baud == 19200
    assert settings.hardware.esp32.calibration.slope == 0.01
    assert settings.hardware.state_timeouts.tension_check_ms == 30000
    assert settings.storage.db_url == "sqlite:///./test.db"


def test_load_settings_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_settings(tmp_path / "nope.yaml")
