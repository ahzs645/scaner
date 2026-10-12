"""Bonjour discovery helpers for Epson network scanners."""

from __future__ import annotations

import os
import pty
import select
import shlex
import shutil
import subprocess
import time
from typing import Callable, Sequence

from ..errors import TransportUnavailableError
from ._network_models import BonjourServiceAdvertisement, ResolvedBonjourService

DnsSdRunner = Callable[[Sequence[str], float], str]


def discover_scanners(
    *,
    service_types: Sequence[str],
    domain: str,
    timeout: float,
    runner: DnsSdRunner,
    fallback_name: str | None = None,
) -> list[ResolvedBonjourService]:
    advertisements = discover_bonjour_services(
        service_types=service_types,
        domain=domain,
        timeout=timeout,
        runner=runner,
    )
    resolved: list[ResolvedBonjourService] = []
    seen: set[tuple[str, str, str]] = set()

    for advertisement in advertisements:
        if advertisement.action != "Add":
            continue
        key = (
            advertisement.instance_name,
            advertisement.service_type,
            advertisement.domain,
        )
        if key in seen:
            continue
        seen.add(key)

        service = resolve_bonjour_service(
            advertisement.instance_name,
            advertisement.service_type,
            domain=advertisement.domain,
            timeout=timeout,
            runner=runner,
        )
        if service is not None:
            resolved.append(service)

    if not resolved and fallback_name is not None and "_scanner._tcp" in service_types:
        fallback = resolve_bonjour_service(
            fallback_name,
            "_scanner._tcp",
            domain=domain,
            timeout=timeout,
            runner=runner,
        )
        if fallback is not None:
            resolved.append(fallback)

    return resolved


def discover_bonjour_services(
    *,
    service_types: Sequence[str],
    domain: str,
    timeout: float,
    runner: DnsSdRunner,
) -> list[BonjourServiceAdvertisement]:
    results: list[BonjourServiceAdvertisement] = []
    for service_type in service_types:
        output = runner(["-B", service_type, domain], timeout=timeout)
        results.extend(parse_dns_sd_browse_output(output))
    return results


def resolve_bonjour_service(
    instance_name: str,
    service_type: str,
    *,
    domain: str,
    timeout: float,
    runner: DnsSdRunner,
) -> ResolvedBonjourService | None:
    output = runner(["-L", instance_name, service_type, domain], timeout=timeout)
    return parse_dns_sd_resolve_output(
        output,
        instance_name=instance_name,
        service_type=service_type,
        domain=domain,
    )


def run_dns_sd(arguments: Sequence[str], *, timeout: float) -> str:
    dns_sd_path = shutil.which("dns-sd")
    if dns_sd_path is None:
        raise TransportUnavailableError("dns-sd is not available on this system")
    if timeout <= 0:
        raise ValueError("timeout must be > 0")
    return capture_command_with_pty([dns_sd_path, *arguments], timeout=timeout)


def capture_command_with_pty(arguments: Sequence[str], *, timeout: float) -> str:
    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(
        list(arguments),
        stdin=subprocess.DEVNULL,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
    )
    os.close(slave_fd)

    chunks: list[bytes] = []
    deadline = time.monotonic() + timeout
    try:
        while time.monotonic() < deadline:
            wait_timeout = max(0.0, deadline - time.monotonic())
            ready, _, _ = select.select([master_fd], [], [], wait_timeout)
            if master_fd in ready:
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    break
                if not data:
                    break
                chunks.append(data)
            if process.poll() is not None and not ready:
                break
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1.0)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=1.0)
        os.close(master_fd)

    return b"".join(chunks).decode("utf-8", errors="replace")


def parse_dns_sd_browse_output(output: str) -> list[BonjourServiceAdvertisement]:
    results: list[BonjourServiceAdvertisement] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or "Timestamp" in line or line.startswith("Browsing for "):
            continue
        if line.startswith("DATE:") or "...STARTING..." in line:
            continue

        parts = raw_line.split()
        if len(parts) < 7:
            continue
        if parts[1] not in {"Add", "Rmv"}:
            continue

        instance_name = raw_line.split(parts[5], 1)[1].strip()
        results.append(
            BonjourServiceAdvertisement(
                instance_name=instance_name,
                service_type=parts[5].rstrip("."),
                domain=parts[4],
                interface_index=int(parts[3]),
                flags=int(parts[2]),
                action=parts[1],
            )
        )
    return results


def parse_dns_sd_resolve_output(
    output: str,
    *,
    instance_name: str,
    service_type: str,
    domain: str,
) -> ResolvedBonjourService | None:
    host: str | None = None
    port: int | None = None
    interface_index: int | None = None
    fullname: str | None = None
    txt_records: list[str] = []

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("Lookup ") or line.startswith("DATE:"):
            continue
        if "...STARTING..." in line:
            continue
        if " can be reached at " in line:
            left, right = raw_line.split(" can be reached at ", 1)
            fullname = left.split()[-1]
            host_port, interface_part = right.rsplit(" (interface ", 1)
            host_text, port_text = host_port.rsplit(":", 1)
            host = host_text.rstrip(".").strip()
            port = int(port_text)
            interface_index = int(interface_part.rstrip(")"))
            continue
        if raw_line.startswith(" "):
            txt_records.extend(shlex.split(line))

    if host is None or port is None:
        return None

    txt: dict[str, str] = {}
    for record in txt_records:
        if "=" in record:
            key, value = record.split("=", 1)
            txt[key] = value
        else:
            txt[record] = ""

    return ResolvedBonjourService(
        instance_name=instance_name,
        service_type=service_type,
        domain=domain,
        host=host,
        port=port,
        interface_index=interface_index,
        txt=txt,
        txt_records=tuple(txt_records),
        fullname=fullname,
    )
