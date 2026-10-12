"""Small data models shared across CLI, transport, and session layers."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class UsbCandidate:
    vendor_id: int
    product_id: int
    manufacturer: str | None = None
    product: str | None = None
    serial_number: str | None = None
    bus: int | None = None
    address: int | None = None


@dataclass(slots=True)
class EscI2Token:
    name: str
    raw_value: bytes

    @property
    def text(self) -> str:
        return self.raw_value.decode("latin1", errors="replace")


@dataclass(slots=True)
class EscI2Reply:
    command: str
    header_block: bytes
    data_block: bytes = b""
    tokens: list[EscI2Token] = field(default_factory=list)
    extra_length: int = 0
    busy: bool = False


@dataclass(slots=True)
class EscI2ImageBlock:
    header_block: bytes
    data_block: bytes = b""
    tokens: list[EscI2Token] = field(default_factory=list)
    extra_length: int = 0
