from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

# Exact NIST conversion: 1 N = 101.97162129779283 gf
GF_PER_N: float = 101.97162129779283


@dataclass(frozen=True)
class ImadaReading:
    timestamp_ns: int
    force_n: float
    unit: str = "N"


@dataclass(frozen=True)
class Esp32Reading:
    timestamp_ns: int
    force_n: float
    raw: int


@dataclass(frozen=True)
class PlcEvent:
    kind: Literal["bit", "word"]
    addr: int
    value: int | bool
    timestamp_ns: int = 0

    @staticmethod
    def bit(addr: int, value: bool, timestamp_ns: int = 0) -> "PlcEvent":
        return PlcEvent(kind="bit", addr=addr, value=value, timestamp_ns=timestamp_ns)

    @staticmethod
    def word(addr: int, value: int, timestamp_ns: int = 0) -> "PlcEvent":
        return PlcEvent(kind="word", addr=addr, value=value, timestamp_ns=timestamp_ns)


@runtime_checkable
class PlcClient(Protocol):
    @property
    def is_connected(self) -> bool: ...
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
    def write_word(self, addr: int, value: int) -> None: ...
    def read_word(self, addr: int) -> int: ...
    def set_bit(self, addr: int, on: bool) -> None: ...
    def read_bit(self, addr: int) -> bool: ...


@runtime_checkable
class ImadaClient(Protocol):
    @property
    def is_connected(self) -> bool: ...
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
    def tare(self) -> None: ...


@runtime_checkable
class Esp32Client(Protocol):
    @property
    def is_connected(self) -> bool: ...
    def connect(self) -> None: ...
    def disconnect(self) -> None: ...
    def tare(self) -> None: ...
