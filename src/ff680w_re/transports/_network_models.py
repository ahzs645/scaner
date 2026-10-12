"""Shared models for Epson network transport work."""

from __future__ import annotations

from dataclasses import dataclass, field
import shutil

from ..constants import EPSON_NETWORK_PORT, EPSON_USCAN_SERVICE, MODEL_NAME
from ..vendor_data import NETWORK_HINTS

ICA_DISCOVERY_SERVICES = (EPSON_USCAN_SERVICE, "_ippusb._tcp")
EVENT_MANAGER_SETTINGS_PATH = (
    "~/Library/Preferences/EPSON/Event Manager/Settings/NetWorkScanSetting.plist"
)
EVENT_MANAGER_LOG_PATH = (
    "~/Library/Preferences/EPSON/Event Manager/Settings/NetWorkLogInfo.plist"
)


@dataclass(slots=True)
class NetworkTransportStatus:
    implemented: bool = False
    port: int = EPSON_NETWORK_PORT
    bonjour_services: tuple[str, ...] = tuple(NETWORK_HINTS["bonjour_services"])
    alternate_bonjour_services: tuple[str, ...] = ICA_DISCOVERY_SERVICES
    uri_formats: tuple[str, ...] = tuple(NETWORK_HINTS["uri_formats"])
    source_path: str = str(NETWORK_HINTS["source_path"])
    dns_sd_path: str | None = shutil.which("dns-sd")
    snmpget_path: str | None = shutil.which("snmpget")
    note: str = (
        "Scaffold plus live probes. Local apps show a proprietary Epson path "
        "(_scanner._tcp + epsontcpip:// + EpsonScan2.framework/XIOP) and a "
        "separate ICA path (_uscan._tcp). Live LAN testing confirmed Bonjour "
        "advertising for EPSON FF-680W on _scanner._tcp, a reachable TCP "
        "endpoint on port 1865, and readable Epson enterprise SNMP OIDs for "
        "pairing and session-address state."
    )


@dataclass(slots=True)
class LocalWifiHints:
    port: int
    bonjour_services: tuple[str, ...]
    alternate_bonjour_services: tuple[str, ...]
    uri_formats: tuple[str, ...]
    source_path: str
    event_manager_settings_path: str
    event_manager_log_path: str
    snmpget_path: str | None
    example_uri: str


@dataclass(slots=True)
class BonjourServiceAdvertisement:
    instance_name: str
    service_type: str
    domain: str
    interface_index: int
    flags: int
    action: str


@dataclass(slots=True)
class ResolvedBonjourService:
    instance_name: str
    service_type: str
    domain: str
    host: str
    port: int
    interface_index: int | None
    txt: dict[str, str]
    txt_records: tuple[str, ...]
    fullname: str | None = None


@dataclass(slots=True)
class EpsonTcpIpEndpoint:
    host: str
    port: int = EPSON_NETWORK_PORT
    vendor_name: str = "EPSON"
    model_name: str = MODEL_NAME
    display_name: str | None = None
    service_name: str | None = None
    service_type: str = "_scanner._tcp"
    domain: str = "local."
    txt: dict[str, str] = field(default_factory=dict)

    @property
    def clean_host(self) -> str:
        return self.host.rstrip(".")

    @property
    def label(self) -> str:
        return self.display_name or f"{self.model_name} (IP)"


@dataclass(slots=True)
class TcpProbeResult:
    host: str
    port: int
    reachable: bool
    timeout: float
    latency_ms: float | None = None
    resolved_ip: str | None = None
    error: str | None = None


@dataclass(slots=True)
class NetworkTlsProbeResult:
    endpoint: EpsonTcpIpEndpoint
    uri: str
    timeout: float
    verify_peer: bool
    server_hostname: str | None
    tcp_connected: bool
    tls_established: bool
    resolved_ip: str | None = None
    latency_ms: float | None = None
    tls_version: str | None = None
    cipher_suite: str | None = None
    peer_certificate_subject: str | None = None
    error: str | None = None


@dataclass(slots=True)
class ParsedNetworkReply:
    opcode: int
    header_code: int
    payload_length: int
    payload: bytes
    reserved: bytes


@dataclass(slots=True)
class ParsedNetworkGreeting:
    payload_prefix: bytes
    address_family_code: int | None
    address_length: int | None
    address_bytes: bytes
    inferred_ipv6_address: str | None = None
    note: str | None = None


@dataclass(slots=True)
class NetworkCommandProbeResult:
    host: str
    port: int
    command: str
    opcode: int
    reply_length: int
    sent_bytes: int
    response: bytes
    timeout: float
    resolved_ip: str | None = None
    latency_ms: float | None = None
    parsed_reply: ParsedNetworkReply | None = None
    error: str | None = None


@dataclass(slots=True)
class NetworkSessionExchange:
    name: str
    opcode: int
    request: bytes
    response: bytes
    parsed_reply: ParsedNetworkReply | None = None
    parsed_greeting: ParsedNetworkGreeting | None = None
    error: str | None = None


@dataclass(slots=True)
class NetworkGreetingProbeResult:
    endpoint: EpsonTcpIpEndpoint
    uri: str
    timeout: float
    greeting: NetworkSessionExchange | None
    closed_after_greeting: bool | None
    resolved_ip: str | None = None
    latency_ms: float | None = None
    error: str | None = None


@dataclass(slots=True)
class NetworkStartupResult:
    endpoint: EpsonTcpIpEndpoint
    uri: str
    timeout: float
    connected: bool
    exchanges: tuple[NetworkSessionExchange, ...]
    resolved_ip: str | None = None
    latency_ms: float | None = None
    error: str | None = None


@dataclass(slots=True)
class SnmpScalarValue:
    name: str
    oid: str
    value_type: str | None
    raw_value: str | None
    value: str | int | bytes | None
    error: str | None = None


@dataclass(slots=True)
class NetworkSnmpSnapshot:
    host: str
    community: str
    version: str
    timeout: float
    tool_path: str
    values: tuple[SnmpScalarValue, ...]
    resolved_ip: str | None = None
    error: str | None = None


@dataclass(slots=True)
class EventManagerNetworkSettings:
    settings_path: str
    log_path: str
    settings_exists: bool
    enabled: bool | None
    pc_name: str | None
    log_message: str | None
    error: str | None = None


@dataclass(slots=True)
class WebConfigStatus:
    url: str
    status_code: int | None
    title: str | None
    header_text: str | None
    form_action: str | None
    force_password_required: bool
    admin_page_accessible: bool = False
    redirect_path: str | None = None
    error: str | None = None


@dataclass(slots=True)
class NetworkPairState:
    endpoint: EpsonTcpIpEndpoint
    bonjour_scanner_available: str | None
    bonjour_adminurl: str | None
    event_manager: EventManagerNetworkSettings
    webconfig: WebConfigStatus
    snmp: NetworkSnmpSnapshot
    session_address: str | None = None
    session_address_matches_local_interface: bool | None = None
    session_address_interface: str | None = None
