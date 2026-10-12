"""Bounded settings-only Epson network experiment; never starts acquisition.

Wire sequence is based on the task's pinned SANE epsonds-net/tcp/io source.
This is deliberately separate from the unfinished public NetworkTransport.
Run explicitly with an IP literal: python -m ff680w_re.network_settings_probe IP
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
from ipaddress import ip_address
import json
import math
import socket
from time import monotonic
from typing import Callable

from .errors import ProtocolError
from .protocol import build_header, build_network_passthrough_frame, parse_extra_length, parse_tokens

MAX_SETTINGS_BYTES = 1024 * 1024
SETTINGS_COMMANDS = ("INFO", "CAPA", "RESA", "STAT")
IDLE_GREETING = bytes.fromhex("0104000000")
LOCK_PAYLOAD = bytes.fromhex("01a0040000012c")


@dataclass(slots=True)
class NetworkSettingsResult:
    host: str
    port: int
    success: bool = False
    settings: dict[str, object] = field(default_factory=dict)
    frames: list[dict[str, object]] = field(default_factory=list)
    error: str | None = None
    cleanup_errors: list[str] = field(default_factory=list)
    note: str = "Settings-only protocol experiment; image acquisition is not implemented or tested."


class _Wire:
    def __init__(self, sock: object, result: NetworkSettingsResult, timeout: float, deadline: float):
        self.sock = sock
        self.result = result
        self.timeout = timeout
        self.deadline = deadline

    def _bound(self) -> None:
        remaining = self.deadline - monotonic()
        if remaining <= 0:
            raise TimeoutError("network settings probe deadline exceeded")
        self.sock.settimeout(min(self.timeout, remaining))

    def send(self, name: str, opcode: int, payload: bytes = b"", expected: int = 0) -> None:
        packet = build_network_passthrough_frame(opcode, payload, reply_length=expected)
        self._bound()
        self.result.frames.append({"direction": "out", "step": name, "hex": packet.hex()})
        self.sock.sendall(packet)

    def _exact(self, count: int) -> bytes:
        data = bytearray()
        while len(data) < count:
            self._bound()
            part = self.sock.recv(count - len(data))
            if not part:
                raise ProtocolError(f"network EOF: expected {count} bytes, received {len(data)}")
            data.extend(part)
        return bytes(data)

    def receive(self, name: str, *, maximum: int = MAX_SETTINGS_BYTES) -> bytes:
        header = self._exact(12)
        self.result.frames.append({"direction": "in", "step": name, "header_hex": header.hex()})
        if header[:2] != b"IS":
            raise ProtocolError("network response does not begin with IS")
        if header[4:6] != b"\x38\x0c" and header[4:6] != b"\x00\x0c":
            raise ProtocolError(f"unrecognized network response header code: {header[4:6].hex()}")
        size = int.from_bytes(header[6:10], "big")
        if size > maximum:
            raise ProtocolError(f"network response exceeds {maximum}-byte settings bound")
        payload = self._exact(size)
        self.result.frames[-1].update({"hex": (header + payload).hex(), "opcode": int.from_bytes(header[2:4], "big"), "payload_bytes": size})
        return payload

    def ack(self, name: str) -> None:
        reply = self.receive(name, maximum=1)
        if reply != b"\x06":
            raise ProtocolError(f"{name} did not acknowledge the session: {reply.hex()}")

    def query(self, command: str) -> dict[str, object]:
        # No caller-controlled arbitrary command or payload is admitted here.
        if command not in (*SETTINGS_COMMANDS, "FIN "):
            raise ProtocolError("settings probe command is not allowed")
        self.send(command, 0x2000, build_header(command), expected=64)
        immediate = self.receive(command, maximum=64)
        if len(immediate) != 64:
            raise ProtocolError(f"short {command} immediate response: {len(immediate)}")
        size = parse_extra_length(command, immediate[:12])
        if size > MAX_SETTINGS_BYTES:
            raise ProtocolError("advertised settings data exceeds the 1 MiB bound")
        extra = b""
        if size:
            # SANE's network receiver requests each additional data block;
            # merely reading the bare TCP stream is insufficient.
            self.send(command + " DATA", 0x2000, expected=size)
            extra = self.receive(command + " DATA", maximum=size)
            if len(extra) != size:
                raise ProtocolError(f"short {command} extra data: expected {size}, got {len(extra)}")
        items = parse_tokens(immediate[12:]) + parse_tokens(extra)
        if any(token.name.lower() == "nrd" for token in items):
            raise ProtocolError(f"{command.strip()} reports not-ready")
        return {"header": immediate[:12].decode("ascii"), "data_bytes": size,
                "tokens": [{"name": token.name, "value": token.text} for token in items]}


def probe_network_settings(
    host: str, *, port: int = 1865, timeout: float = 3.0, deadline_seconds: float = 20.0,
    connector: Callable[..., object] = socket.create_connection,
) -> NetworkSettingsResult:
    """Read settings on ONE explicitly selected numeric endpoint, without TLS fallback.

    Refuse any greeting except the captured idle 5-byte payload. Busy or unknown
    greetings are retained without issuing a lock, takeover, reset, or writes to
    scanner settings. Session locks/finalization are control effects, not wholly
    passive observation. No paper-feed/image commands or SNMP writes are sent.
    """
    ip_address(host)  # Avoid discovery, DNS scanning, or a guessed default host.
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    if not all(isinstance(value, (int, float)) and math.isfinite(value) and value > 0 for value in (timeout, deadline_seconds)):
        raise ValueError("timeouts must be positive finite numbers")
    result = NetworkSettingsResult(host=host, port=port)
    deadline = monotonic() + deadline_seconds
    sock = None
    locked = False
    controlled = False
    try:
        sock = connector((host, port), timeout=min(timeout, deadline_seconds))
        wire = _Wire(sock, result, timeout, deadline)
        greeting = wire.receive("WELCOME", maximum=256)
        if greeting != IDLE_GREETING:
            raise ProtocolError("busy or unrecognized greeting; no session commands sent")
        wire.send("LOCK", 0x2100, LOCK_PAYLOAD)
        wire.ack("LOCK")
        locked = True
        wire.send("FSX", 0x2000, b"\x1c\x58", expected=1)
        wire.ack("FSX")
        controlled = True
        for command in SETTINGS_COMMANDS:
            result.settings[command] = wire.query(command)
    except (OSError, ProtocolError) as error:
        result.error = f"{type(error).__name__}: {error}"
    finally:
        if sock is not None:
            # A separate small cleanup budget guarantees a bounded release
            # attempt even if the primary I/O deadline was exhausted.
            cleanup = _Wire(sock, result, timeout, monotonic() + timeout)
            if controlled:
                try:
                    final = cleanup.query("FIN ")
                    if any(item["name"].lower() in {"err", "atn", "nrd"} for item in final["tokens"]):
                        raise ProtocolError("FIN reports a scanner error")
                except (OSError, ProtocolError) as error:
                    result.cleanup_errors.append(f"FIN: {type(error).__name__}: {error}")
            if locked:
                try:
                    # Upstream sends outer unlock without awaiting a reply.
                    cleanup.send("UNLOCK", 0x2101)
                except (OSError, ProtocolError) as error:
                    result.cleanup_errors.append(f"UNLOCK: {type(error).__name__}: {error}")
            try:
                sock.close()
            except OSError as error:
                result.cleanup_errors.append(f"CLOSE: {error}")
    result.success = result.error is None and not result.cleanup_errors and len(result.settings) == len(SETTINGS_COMMANDS)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Explicit settings-only FF-680W network experiment; does not feed or scan paper")
    parser.add_argument("host", help="numeric IPv4/IPv6 address from the selected scanner's discovery")
    parser.add_argument("--port", type=int, default=1865)
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--deadline", type=float, default=20.0)
    args = parser.parse_args()
    result = probe_network_settings(args.host, port=args.port, timeout=args.timeout, deadline_seconds=args.deadline)
    print(json.dumps(asdict(result), indent=2))
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
