"""Helpers for Epson network state outside the raw TCP transport."""

from __future__ import annotations

import html
import ipaddress
import plistlib
import re
import ssl
import subprocess
import urllib.request
from pathlib import Path
from typing import Callable

from ._network_models import (
    EVENT_MANAGER_LOG_PATH,
    EVENT_MANAGER_SETTINGS_PATH,
    EpsonTcpIpEndpoint,
    EventManagerNetworkSettings,
    NetworkPairState,
    WebConfigStatus,
)
from ._network_snmp import (
    SNMP_DEFAULT_COMMUNITY,
    SNMP_DEFAULT_VERSION,
    probe_scanner_snmp,
)

WebFetcher = Callable[[str, float], tuple[int, str]]

_TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_HEADER_RE = re.compile(
    r'<div class="header-main">(.*?)</div>',
    re.IGNORECASE | re.DOTALL,
)
_FORM_ACTION_RE = re.compile(
    r'<form[^>]+action="([^"]+)"',
    re.IGNORECASE | re.DOTALL,
)
_FORCE_PASSWORD_RE = re.compile(r"FORCE_PASSWORD/TOP", re.IGNORECASE)
_LOCATION_RE = re.compile(r"location\.href='([^']+)'", re.IGNORECASE)


def read_event_manager_network_settings(
    *,
    settings_path: str = EVENT_MANAGER_SETTINGS_PATH,
    log_path: str = EVENT_MANAGER_LOG_PATH,
) -> EventManagerNetworkSettings:
    """Read Event Manager's local network-scan settings and last log message."""

    settings_file = Path(settings_path).expanduser()
    log_file = Path(log_path).expanduser()
    enabled = None
    pc_name = None
    log_message = None
    error = None

    try:
        if settings_file.exists():
            with settings_file.open("rb") as handle:
                settings = plistlib.load(handle)
            enabled = _coerce_bool(settings.get("EnableNetWorkScan"))
            pc_name = _coerce_text(settings.get("PCName"))
    except (OSError, plistlib.InvalidFileException, ValueError) as exc:
        error = f"settings read failed: {exc}"

    try:
        if log_file.exists():
            with log_file.open("rb") as handle:
                log_settings = plistlib.load(handle)
            log_message = _coerce_text(log_settings.get("NetWorkLogInfo"))
    except (OSError, plistlib.InvalidFileException, ValueError) as exc:
        message = f"log read failed: {exc}"
        error = f"{error}; {message}" if error else message

    return EventManagerNetworkSettings(
        settings_path=str(settings_file),
        log_path=str(log_file),
        settings_exists=settings_file.exists(),
        enabled=enabled,
        pc_name=pc_name,
        log_message=log_message,
        error=error,
    )


def probe_webconfig_state(
    host: str,
    *,
    timeout: float = 2.0,
    fetcher: WebFetcher | None = None,
) -> WebConfigStatus:
    """Probe the scanner's WebConfig gate and detect forced-password setup."""

    base = f"https://{host.rstrip('.')}"
    common_url = f"{base}/PRESENTATION/ADVANCED/COMMON/TOP"
    selected_fetcher = fetcher or _fetch_https_text
    try:
        common_status, common_html = selected_fetcher(common_url, timeout)
    except OSError as exc:
        return WebConfigStatus(
            url=common_url,
            status_code=None,
            title=None,
            header_text=None,
            form_action=None,
            force_password_required=False,
            admin_page_accessible=False,
            error=str(exc),
        )

    common_title = _extract_html_text(_TITLE_RE, common_html)
    common_header = _extract_html_text(_HEADER_RE, common_html)
    common_form_action = _extract_html_text(_FORM_ACTION_RE, common_html)
    force_path = _discover_force_password_path(common_html)
    force_password_required = bool(_FORCE_PASSWORD_RE.search(common_html))

    if not force_password_required and force_path is None:
        return WebConfigStatus(
            url=common_url,
            status_code=common_status,
            title=common_title,
            header_text=common_header,
            form_action=common_form_action,
            force_password_required=False,
            admin_page_accessible=common_status == 200,
            error=None,
        )

    force_path = force_path or "/PRESENTATION/ADVANCED/FORCE_PASSWORD/TOP?accsessmethod=0"
    force_url = f"{base}{force_path}"
    try:
        force_status, force_html = selected_fetcher(force_url, timeout)
    except OSError as exc:
        return WebConfigStatus(
            url=force_url,
            status_code=common_status,
            title=common_title,
            header_text=common_header,
            form_action=common_form_action,
            force_password_required=force_password_required,
            admin_page_accessible=common_status == 200 and not force_password_required,
            redirect_path=force_path,
            error=str(exc),
        )

    title = _extract_html_text(_TITLE_RE, force_html)
    header_text = _extract_html_text(_HEADER_RE, force_html)
    form_action = _extract_html_text(_FORM_ACTION_RE, force_html)
    force_password_required = (
        force_password_required
        or (header_text == "Change Administrator Password")
        or ("Change Administrator Password" in force_html)
    )
    return WebConfigStatus(
        url=force_url,
        status_code=force_status,
        title=title,
        header_text=header_text,
        form_action=form_action,
        force_password_required=force_password_required,
        admin_page_accessible=force_status == 200 and not force_password_required,
        redirect_path=force_path,
        error=None,
    )


def probe_network_pair_state(
    endpoint: EpsonTcpIpEndpoint,
    *,
    community: str = SNMP_DEFAULT_COMMUNITY,
    version: str = SNMP_DEFAULT_VERSION,
    timeout: float = 2.0,
    fetcher: WebFetcher | None = None,
) -> NetworkPairState:
    """Combine Bonjour, Event Manager, WebConfig, and SNMP pairing state."""

    webconfig = probe_webconfig_state(
        endpoint.clean_host,
        timeout=timeout,
        fetcher=fetcher,
    )
    snmp = probe_scanner_snmp(
        endpoint.clean_host,
        community=community,
        version=version,
        timeout=timeout,
    )
    session_address = _extract_named_snmp_string(snmp, "session_address")
    session_interface = _find_local_interface_for_address(session_address)
    return NetworkPairState(
        endpoint=endpoint,
        bonjour_scanner_available=endpoint.txt.get("scannerAvailable"),
        bonjour_adminurl=endpoint.txt.get("adminurl"),
        event_manager=read_event_manager_network_settings(),
        webconfig=webconfig,
        snmp=snmp,
        session_address=session_address,
        session_address_matches_local_interface=(
            session_interface is not None if session_address is not None else None
        ),
        session_address_interface=session_interface,
    )


def _fetch_https_text(url: str, timeout: float) -> tuple[int, str]:
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(url, timeout=timeout, context=context) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        body = response.read().decode(charset, errors="replace")
        return response.status, body


def _discover_force_password_path(common_html: str) -> str | None:
    match = _LOCATION_RE.search(common_html)
    if match is None:
        return None
    return html.unescape(match.group(1))


def _extract_html_text(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    if match is None:
        return None
    value = html.unescape(match.group(1))
    return re.sub(r"\s+", " ", value).strip()


def _coerce_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _coerce_text(value: object) -> str | None:
    if isinstance(value, str):
        return value
    return None


def _extract_named_snmp_string(snapshot, name: str) -> str | None:
    for value in snapshot.values:
        if value.name != name or value.error is not None:
            continue
        if isinstance(value.value, str):
            return value.value
    return None


def _find_local_interface_for_address(address: str | None) -> str | None:
    if not address:
        return None

    normalized = _normalize_ip_text(address)
    if normalized is None:
        return None

    interfaces = _read_local_interface_addresses()
    for interface_name, local_address in interfaces:
        if normalized == local_address:
            return interface_name
    return None


def _read_local_interface_addresses() -> list[tuple[str, str]]:
    result = subprocess.run(
        ["ifconfig"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return []

    interfaces: list[tuple[str, str]] = []
    current_interface: str | None = None
    for raw_line in result.stdout.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue
        if not raw_line[:1].isspace():
            current_interface = line.split(":", 1)[0]
            continue
        if current_interface is None:
            continue
        stripped = line.strip()
        if stripped.startswith("inet6 "):
            candidate = stripped.split()[1]
        elif stripped.startswith("inet "):
            candidate = stripped.split()[1]
        else:
            continue
        normalized = _normalize_ip_text(candidate)
        if normalized is not None:
            interfaces.append((current_interface, normalized))
    return interfaces


def _normalize_ip_text(text: str) -> str | None:
    candidate = text.split("%", 1)[0]
    try:
        return ipaddress.ip_address(candidate).compressed
    except ValueError:
        return None
