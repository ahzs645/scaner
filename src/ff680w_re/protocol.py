"""ESC/I-2 protocol helpers."""

from __future__ import annotations

from enum import StrEnum

from .constants import ESCI2_HEADER_SIZE
from .errors import ProtocolError
from .models import EscI2Token


class EscI2Command(StrEnum):
    INFO = "INFO"
    CAPA = "CAPA"
    STAT = "STAT"
    RESA = "RESA"
    PARA = "PARA"
    MECH = "MECH"
    TRDT = "TRDT"
    IMG = "IMG "
    FIN = "FIN "
    CAN = "CAN "


def build_header(command: str | EscI2Command, payload_length: int = 0) -> bytes:
    command4 = _normalize_command(command)
    if payload_length < 0:
        raise ValueError("payload_length must be >= 0")
    return f"{command4}x{payload_length:07x}".encode("ascii")


def parse_extra_length(expected_command: str | EscI2Command, header: bytes) -> int:
    command4 = _normalize_command(expected_command)
    if len(header) < ESCI2_HEADER_SIZE:
        raise ProtocolError(
            f"header too short: expected at least {ESCI2_HEADER_SIZE} bytes, got {len(header)}"
        )
    if header[:4] != command4.encode("ascii"):
        raise ProtocolError(
            f"unexpected command in reply header: expected {command4!r}, got {header[:4]!r}"
        )
    if header[4:5] != b"x":
        raise ProtocolError(f"unexpected header format: {header[:ESCI2_HEADER_SIZE]!r}")
    try:
        return int(header[5:12].decode("ascii"), 16)
    except ValueError as exc:
        raise ProtocolError(f"invalid reply length in header: {header[:ESCI2_HEADER_SIZE]!r}") from exc


def is_busy_reply(block: bytes) -> bool:
    if len(block) <= ESCI2_HEADER_SIZE:
        return False
    return b"#nrdBUSY" in block[ESCI2_HEADER_SIZE:]


def parse_tokens(block: bytes) -> list[EscI2Token]:
    tokens: list[EscI2Token] = []
    start = 0
    end = len(block)

    while start < end:
        hash_index = block.find(b"#", start)
        if hash_index == -1 or hash_index + 4 > end:
            break

        name = block[hash_index + 1 : hash_index + 4].decode("latin1", errors="replace")
        if name == "---":
            break

        value_start = hash_index + 4
        # GMT contains four bytes of channel name, hNNN, and a binary LUT.
        # NUL and '#' inside that LUT are data, not token delimiters.
        if name == "GMT" and block[value_start + 4:value_start + 5] == b"h":
            try:
                binary_size = int(block[value_start + 5:value_start + 8], 16)
            except ValueError as exc:
                raise ProtocolError("invalid GMT binary length") from exc
            stop = value_start + 8 + binary_size
            if stop > end:
                raise ProtocolError("truncated GMT binary table")
            tokens.append(EscI2Token(name=name, raw_value=block[value_start:stop]))
            start = stop
            continue

        next_hash = block.find(b"#", hash_index + 1)
        next_nul = block.find(b"\x00", hash_index + 1)
        candidates = [idx for idx in (next_hash, next_nul) if idx != -1]
        stop = min(candidates) if candidates else end

        raw_value = block[value_start:stop]
        tokens.append(EscI2Token(name=name, raw_value=raw_value))
        start = stop

    return tokens


def build_network_passthrough_frame(
    opcode: int,
    payload: bytes = b"",
    reply_length: int = 0,
) -> bytes:
    if not 0 <= opcode <= 0xFFFF:
        raise ValueError("opcode must fit in 16 bits")

    header = bytearray(12)
    header[0:2] = b"IS"
    header[2] = (opcode >> 8) & 0xFF
    header[3] = opcode & 0xFF
    header[4:6] = b"\x00\x0c"

    if (opcode >> 8) == 0x20:
        total_length = len(payload) + 8
        header[6:10] = total_length.to_bytes(4, "big")
        data_header = len(payload).to_bytes(4, "big") + reply_length.to_bytes(4, "big")
        return bytes(header) + data_header + payload

    header[6:10] = len(payload).to_bytes(4, "big")
    return bytes(header) + payload


def _normalize_command(command: str | EscI2Command) -> str:
    command4 = str(command)
    if len(command4) != 4:
        raise ValueError(f"ESC/I-2 commands must be exactly 4 characters: {command4!r}")
    return command4

