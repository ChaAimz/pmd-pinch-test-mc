from app.logging_setup import configure_logging


def test_configure_logging_returns_logger(tmp_path):
    logger = configure_logging(level="DEBUG", log_dir=tmp_path)
    logger.debug("hello")
    log_files = list(tmp_path.glob("*.log"))
    assert len(log_files) == 1


def test_configure_logging_default_level(tmp_path):
    logger = configure_logging(level="INFO", log_dir=tmp_path)
    assert logger is not None
