from __future__ import annotations

from typing import Iterator

from sqlmodel import Session, create_engine

_engine = None


def init_engine(db_url: str):
    global _engine
    _engine = create_engine(db_url, connect_args={"check_same_thread": False})
    return _engine


def get_engine():
    if _engine is None:
        raise RuntimeError("Engine not initialized; call init_engine() first")
    return _engine


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
