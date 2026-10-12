"""SNMP helpers for the Epson local network path."""

from __future__ import annotations

import os
import re
import shutil
import socket
import subprocess
from typing import Callable, Sequence

from ..errors import TransportUnavailableError
from ._network_models import NetworkSnmpSnapshot, SnmpScalarValue

SNMP_DEFAULT_COMMUNITY = "public"
SNMP_DEFAULT_VERSION = "1"
SNMP_GET_TOOL = "snmpget"

# These OIDs are the concrete Epson-enterprise leaves surfaced in ScanSmart and
# ButtonManager while handling network scan and pairing state.
EPSON_SNMP_OIDS: tuple[tuple[str, str], ...] = (
    ("sys_name", ".1.3.6.1.2.1.1.5.0"),
    ("model_name", ".1.3.6.1.4.1.1248.1.1.3.1.3.8.0"),
    ("display_name", ".1.3.6.1.4.1.1248.1.1.3.1.14.4.1.2.1"),
    ("bonjour_host_name", ".1.3.6.1.4.1.1248.1.1.3.1.14.7.0"),
    ("firmware", ".1.3.6.1.4.1.1248.1.1.3.1.21.1.1.2.5"),
    ("pairing_slot_state", ".1.3.6.1.4.1.1248.1.1.3.1.10.1.0"),
    ("pairing_host", ".1.3.6.1.4.1.1248.1.1.3.1.10.2.5.0"),
    ("session_address_family", ".1.3.6.1.4.1.1248.1.4.2.21.1.1.1.1"),
    ("session_address", ".1.3.6.1.4.1.1248.1.4.2.21.1.1.2.1"),
    ("app_mib_30_1_1", ".1.3.6.1.4.1.1248.1.1.3.1.30.1.1.0"),
    ("app_mib_30_1_3", ".1.3.6.1.4.1.1248.1.1.3.1.30.1.3.0"),
    ("app_mib_30_2_5", ".1.3.6.1.4.1.1248.1.1.3.1.30.2.5.0"),
)

_SNMP_LINE_RE = re.compile(r"^(?P<label>.+?)\s*=\s*(?:(?P<type>[^:]+):\s*)?(?P<value>.*)$")
SnmpRunner = Callable[[Sequence[str], float], tuple[int, str, str]]


def snmpget_path() -> str | None:
    """Return the current snmpget path if net-snmp is installed."""

    return shutil.which(SNMP_GET_TOOL)


def run_snmp_command(arguments: Sequence[str], timeout: float) -> tuple[int, str, str]:
    """Run a net-snmp command and return exit code, stdout, and stderr."""

    tool_path = snmpget_path()
    if tool_path is None:
        raise TransportUnavailableError("snmpget is not installed or not on PATH")

    result = subprocess.run(
        [tool_path, *arguments],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
        env={**os.environ, "LC_ALL": "C"},
    )
    return result.returncode, result.stdout, result.stderr


def parse_snmp_value(
    name: str,
    oid: str,
    *,
    stdout: str,
    stderr: str = "",
    returncode: int = 0,
) -> SnmpScalarValue:
    """Parse a single snmpget response into a typed scalar value."""

    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if not lines:
        error = stderr.strip() or f"snmpget exited with status {returncode}"
        return SnmpScalarValue(
            name=name,
            oid=oid,
            value_type=None,
            raw_value=None,
            value=None,
            error=error,
        )

    match = _SNMP_LINE_RE.match(lines[-1])
    if match is None:
        error = stderr.strip() or f"could not parse snmp output: {lines[-1]!r}"
        return SnmpScalarValue(
            name=name,
            oid=oid,
            value_type=None,
            raw_value=lines[-1],
            value=None,
            error=error,
        )

    value_type = (match.group("type") or "").strip() or None
    raw_value = match.group("value").strip()
    value = _coerce_snmp_value(value_type, raw_value)
    error = None if returncode == 0 else stderr.strip() or f"snmpget exited with status {returncode}"
    return SnmpScalarValue(
        name=name,
        oid=oid,
        value_type=value_type,
        raw_value=raw_value,
        value=value,
        error=error,
    )


def probe_scanner_snmp(
    host: str,
    *,
    community: str = SNMP_DEFAULT_COMMUNITY,
    version: str = SNMP_DEFAULT_VERSION,
    timeout: float = 2.0,
    runner: SnmpRunner = run_snmp_command,
) -> NetworkSnmpSnapshot:
    """Read the app-referenced Epson SNMP leaves from a scanner."""

    tool_path = snmpget_path()
    if tool_path is None:
        raise TransportUnavailableError("snmpget is not installed or not on PATH")

    values: list[SnmpScalarValue] = []
    for name, oid in EPSON_SNMP_OIDS:
        returncode, stdout, stderr = runner(
            ["-v" + version, "-c", community, host, oid],
            timeout,
        )
        values.append(
            parse_snmp_value(
                name,
                oid,
                stdout=stdout,
                stderr=stderr,
                returncode=returncode,
            )
        )

    return NetworkSnmpSnapshot(
        host=host,
        community=community,
        version=version,
        timeout=timeout,
        tool_path=tool_path,
        values=tuple(values),
        resolved_ip=_resolve_ipv4(host),
        error=None,
    )


def format_snmp_value(value: str | int | bytes | None) -> str:
    """Render a parsed SNMP value for CLI output."""

    if isinstance(value, bytes):
        return value.hex()
    if value is None:
        return ""
    return str(value)


def _coerce_snmp_value(value_type: str | None, raw_value: str) -> str | int | bytes:
    if value_type == "INTEGER":
        return int(raw_value)
    if value_type == "STRING":
        if raw_value.startswith('"') and raw_value.endswith('"'):
            return raw_value[1:-1]
        return raw_value
    if value_type == "Hex-STRING":
        parts = [part for part in raw_value.split() if part]
        return bytes.fromhex("".join(parts))
    return raw_value


def _resolve_ipv4(host: str) -> str | None:
    try:
        return socket.gethostbyname(host.rstrip("."))
    except OSError:
        return None
