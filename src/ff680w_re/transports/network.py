"""Public facade for the Epson network transport helpers."""

from __future__ import annotations

from typing import Sequence

from ..constants import MODEL_NAME
from . import _network_discovery as discovery
from ._network_models import (
    BonjourServiceAdvertisement,
    EpsonTcpIpEndpoint,
    EventManagerNetworkSettings,
    ICA_DISCOVERY_SERVICES,
    LocalWifiHints,
    NetworkCommandProbeResult,
    NetworkGreetingProbeResult,
    NetworkPairState,
    NetworkSnmpSnapshot,
    NetworkSessionExchange,
    NetworkStartupResult,
    NetworkTlsProbeResult,
    NetworkTransportStatus,
    ParsedNetworkGreeting,
    ParsedNetworkReply,
    ResolvedBonjourService,
    SnmpScalarValue,
    TcpProbeResult,
    WebConfigStatus,
)
from ._network_snmp import (
    EPSON_SNMP_OIDS,
    SNMP_DEFAULT_COMMUNITY,
    SNMP_DEFAULT_VERSION,
    format_snmp_value,
    parse_snmp_value,
    probe_scanner_snmp,
    snmpget_path,
)
from ._network_state import (
    probe_network_pair_state,
    probe_webconfig_state,
    read_event_manager_network_settings,
)
from ._network_session import (
    NETWORK_PASSTHROUGH_OPCODE,
    NETWORK_SESSION_LOCK_PAYLOAD,
    NETWORK_SESSION_LOCK_OPCODE,
    NETWORK_SESSION_UNLOCK_OPCODE,
    NETWORK_STARTUP_COMMANDS,
    build_epsontcpip_uri,
    build_network_probe_frame,
    build_network_session_frame,
    endpoint_from_bonjour_service,
    local_wifi_hints,
    parse_network_greeting,
    parse_network_reply,
    probe_tcp_endpoint,
    probe_tls_endpoint,
    probe_network_greeting,
    send_network_probe,
    start_network_session,
)

DEFAULT_DISCOVERY_SERVICES = ("_scanner._tcp", "_uscan._tcp")


def discover_scanners(
    *,
    service_types: Sequence[str] | None = DEFAULT_DISCOVERY_SERVICES,
    domain: str = "local.",
    timeout: float = 2.0,
) -> list[ResolvedBonjourService]:
    selected_service_types = tuple(service_types or DEFAULT_DISCOVERY_SERVICES)
    return discovery.discover_scanners(
        service_types=selected_service_types,
        domain=domain,
        timeout=timeout,
        runner=_run_dns_sd,
        fallback_name=f"EPSON {MODEL_NAME}",
    )


def discover_bonjour_services(
    *,
    service_types: Sequence[str] | None = DEFAULT_DISCOVERY_SERVICES,
    domain: str = "local.",
    timeout: float = 2.0,
) -> list[BonjourServiceAdvertisement]:
    selected_service_types = tuple(service_types or DEFAULT_DISCOVERY_SERVICES)
    return discovery.discover_bonjour_services(
        service_types=selected_service_types,
        domain=domain,
        timeout=timeout,
        runner=_run_dns_sd,
    )


def resolve_bonjour_service(
    instance_name: str,
    service_type: str,
    *,
    domain: str = "local.",
    timeout: float = 2.0,
) -> ResolvedBonjourService | None:
    return discovery.resolve_bonjour_service(
        instance_name,
        service_type,
        domain=domain,
        timeout=timeout,
        runner=_run_dns_sd,
    )


def _run_dns_sd(arguments: Sequence[str], *, timeout: float) -> str:
    return discovery.run_dns_sd(arguments, timeout=timeout)


_capture_command_with_pty = discovery.capture_command_with_pty
_parse_dns_sd_browse_output = discovery.parse_dns_sd_browse_output
_parse_dns_sd_resolve_output = discovery.parse_dns_sd_resolve_output


__all__ = [
    "BonjourServiceAdvertisement",
    "DEFAULT_DISCOVERY_SERVICES",
    "EpsonTcpIpEndpoint",
    "EventManagerNetworkSettings",
    "ICA_DISCOVERY_SERVICES",
    "LocalWifiHints",
    "NETWORK_PASSTHROUGH_OPCODE",
    "NETWORK_SESSION_LOCK_PAYLOAD",
    "NETWORK_SESSION_LOCK_OPCODE",
    "NETWORK_SESSION_UNLOCK_OPCODE",
    "NETWORK_STARTUP_COMMANDS",
    "NetworkCommandProbeResult",
    "NetworkGreetingProbeResult",
    "NetworkPairState",
    "NetworkSnmpSnapshot",
    "NetworkSessionExchange",
    "NetworkStartupResult",
    "NetworkTlsProbeResult",
    "NetworkTransportStatus",
    "ParsedNetworkGreeting",
    "ParsedNetworkReply",
    "ResolvedBonjourService",
    "SNMP_DEFAULT_COMMUNITY",
    "SNMP_DEFAULT_VERSION",
    "SnmpScalarValue",
    "TcpProbeResult",
    "WebConfigStatus",
    "EPSON_SNMP_OIDS",
    "build_epsontcpip_uri",
    "build_network_probe_frame",
    "build_network_session_frame",
    "discover_bonjour_services",
    "discover_scanners",
    "endpoint_from_bonjour_service",
    "local_wifi_hints",
    "parse_network_greeting",
    "parse_network_reply",
    "parse_snmp_value",
    "probe_network_pair_state",
    "probe_scanner_snmp",
    "probe_tcp_endpoint",
    "probe_tls_endpoint",
    "probe_network_greeting",
    "probe_webconfig_state",
    "read_event_manager_network_settings",
    "resolve_bonjour_service",
    "send_network_probe",
    "snmpget_path",
    "start_network_session",
    "format_snmp_value",
]
