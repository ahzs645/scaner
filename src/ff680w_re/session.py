"""High-level scanner session helpers."""

from __future__ import annotations

from .constants import (
    ACK,
    ESCI2_CONTROL_REPLY_SIZE,
    ESCI2_IMMEDIATE_REPLY_SIZE,
    FS_LOCK,
    FS_UNLOCK,
    NAK,
)
from .errors import DeviceBusyError, DeviceNakError, ProtocolError
from .models import EscI2ImageBlock, EscI2Reply
from .protocol import EscI2Command, build_header, is_busy_reply, parse_extra_length, parse_tokens
from .transports.base import Transport

_BENIGN_CONTROL_REPLY_HEADERS = (b"UNKNx0000000",)


class EscI2Session:
    """Thin session wrapper around a transport.

    This mirrors the general SANE `epsonds` flow for simple commands:

    - send a 12-byte request header
    - read a 64-byte immediate reply block
    - parse header and tokens
    - read any additional data block if the header advertises one
    """

    def __init__(self, transport: Transport):
        self.transport = transport

    def open(self) -> None:
        self.transport.open()

    def close(self) -> None:
        self.transport.close()

    def lock(self) -> None:
        self._send_control(FS_LOCK)

    def unlock(self) -> None:
        self._send_control(FS_UNLOCK)

    def info(self) -> EscI2Reply:
        return self.query(EscI2Command.INFO)

    def capabilities(self) -> EscI2Reply:
        return self.query(EscI2Command.CAPA)

    def status(self) -> EscI2Reply:
        return self.query(EscI2Command.STAT)

    def resolutions(self) -> EscI2Reply:
        return self.query(EscI2Command.RESA)

    def transfer_data_ready(self) -> EscI2Reply:
        return self.query(EscI2Command.TRDT)

    def set_parameters(self, payload: bytes) -> EscI2Reply:
        return self.query(EscI2Command.PARA, payload=payload)

    def mechanical(self, payload: bytes | str) -> EscI2Reply:
        if isinstance(payload, str):
            payload = payload.encode("ascii")
        return self.query(EscI2Command.MECH, payload=payload)

    def cancel(self) -> EscI2Reply:
        return self.query(EscI2Command.CAN)

    def finish(self) -> EscI2Reply:
        return self.query(EscI2Command.FIN)

    def trace(self, command: str, payload: bytes = b"") -> EscI2Reply:
        return self.query(command, payload=payload)

    def image_block(self) -> EscI2ImageBlock:
        reply_block = self.transport.transact(
            build_header(EscI2Command.IMG), reply_length=ESCI2_IMMEDIATE_REPLY_SIZE
        )
        if len(reply_block) != ESCI2_IMMEDIATE_REPLY_SIZE:
            raise ProtocolError(
                f"short immediate reply: expected {ESCI2_IMMEDIATE_REPLY_SIZE}, got {len(reply_block)}"
            )

        extra_length = parse_extra_length(EscI2Command.IMG, reply_block[:12])
        tokens = parse_tokens(reply_block[12:])
        data_block = b""
        if extra_length:
            data_block = self.transport.recv(extra_length)
            if len(data_block) != extra_length:
                raise ProtocolError(
                    f"short image block: expected {extra_length}, got {len(data_block)}"
                )

        return EscI2ImageBlock(
            header_block=reply_block,
            data_block=data_block,
            tokens=tokens,
            extra_length=extra_length,
        )

    def query(self, command: str | EscI2Command, payload: bytes = b"") -> EscI2Reply:
        header = build_header(command, payload_length=len(payload))

        if payload:
            self.transport.send(header, expected_reply_length=0)
            reply_block = self.transport.transact(
                payload, reply_length=ESCI2_IMMEDIATE_REPLY_SIZE
            )
        else:
            reply_block = self.transport.transact(
                header, reply_length=ESCI2_IMMEDIATE_REPLY_SIZE
            )

        if len(reply_block) != ESCI2_IMMEDIATE_REPLY_SIZE:
            raise ProtocolError(
                f"short immediate reply: expected {ESCI2_IMMEDIATE_REPLY_SIZE}, got {len(reply_block)}"
            )

        if is_busy_reply(reply_block):
            raise DeviceBusyError(f"{command} returned BUSY")

        extra_length = parse_extra_length(command, reply_block[:12])
        header_tokens = parse_tokens(reply_block[12:])
        data_block = b""
        tokens = list(header_tokens)

        if extra_length:
            data_block = self.transport.recv(extra_length)
            if len(data_block) != extra_length:
                raise ProtocolError(
                    f"short data block: expected {extra_length}, got {len(data_block)}"
                )
            tokens.extend(parse_tokens(data_block))

        return EscI2Reply(
            command=str(command),
            header_block=reply_block,
            data_block=data_block,
            tokens=tokens,
            extra_length=extra_length,
            busy=False,
        )

    def _send_control(self, command: bytes) -> None:
        result = self.transport.transact(command, reply_length=ESCI2_CONTROL_REPLY_SIZE)
        if not result:
            raise ProtocolError("control reply was empty")
        if result[0] == ACK:
            return
        if result[0] == NAK:
            raise DeviceNakError(f"control command returned NAK: {command!r}")
        if any(result.startswith(header) for header in _BENIGN_CONTROL_REPLY_HEADERS):
            return
        raise ProtocolError(f"unexpected control reply byte: 0x{result[0]:02x}")
