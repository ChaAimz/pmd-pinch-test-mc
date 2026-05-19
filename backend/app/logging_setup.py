from __future__ import annotations

from pathlib import Path

from loguru import logger


def configure_logging(level: str = "INFO", log_dir: Path | str = "logs"):
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)
    logger.remove()
    logger.add(
        log_path / "app.log",
        rotation="00:00",
        retention="14 days",
        level=level,
        enqueue=True,
        backtrace=True,
        diagnose=False,
    )
    logger.add(
        sink=lambda msg: print(msg, end=""),
        level=level,
    )
    return logger
