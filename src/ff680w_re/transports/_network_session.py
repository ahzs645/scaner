"""Socket, URI, and session helpers for Epson network scanners."""

from __future__ import annotations

from ipaddress import AddressValueError, IPv6Address
import socket
import ssl
import time
from typing import Iterable

from ..constants import EPSON_NETWORK_PORT, ESCI2_IMMEDIATE_REPLY_SIZE, MODEL_NAME
from ..errors import ProtocolError
from ..protocol import build_header, build_network_passthrough_frame
from ._network_snmp import snmpget_path
from ._network_models import (
    EpsonTcpIpEndpoint,
    LocalWifiHints,
    NetworkCommandProbeResult,
    NetworkGreetingProbeResult,
    NetworkSessionExchange,
    NetworkStartupResult,
    NetworkTlsProbeResult,
    ParsedNetworkGreeting,
    ParsedNetworkReply,
    ResolvedBonjourService,
    TcpProbeResult,
    EVENT_MANAGER_LOG_PATH,
    EVENT_MANAGER_SETTINGS_PATH,
    ICA_DISCOVERY_SERVICES,
)
from ..vendor_data import NETWORK_HINTS

NETWORK_PASSTHROUGH_OPCODE = 0x2000
NETWORK_SESSION_LOCK_OPCODE = 0x2100
NETWORK_SESSION_UNLOCK_OPCODE = 0x2101
NETWORK_SESSION_LOCK_PAYLOAD = bytes([0x01, 0xA0, 0x04, 0x00, 0x00, 0x01, 0x2C])
NETWORK_STARTUP_COMMANDS = ("INFO", "STAT")


def local_wifi_hints(host: str = "192.168.1.2") -> LocalWifiHints:
    """Return local Wi-Fi discovery hints derived from Epson's XIOP bundle."""

    return LocalWifiHints(
        port=EPSON_NETWORK_PORT,
        bonjour_services=tuple(NETWORK_HINTS["bonjour_services"]),
        alternate_bonjour_services=ICA_DISCOVERY_SERVICES,
        uri_formats=tuple(NETWORK_HINTS["uri_formats"]),
        source_path=str(NETWORK_HINTS["source_path"]),
        event_manager_settings_path=EVENT_MANAGER_SETTINGS_PATH,
        event_manager_log_path=EVENT_MANAGER_LOG_PATH,
        snmpget_path=snmpget_path(),
        example_uri=build_epsontcpip_uri(host),
    )


def build_epsontcpip_uri(
    host_or_endpoint: str | EpsonTcpIpEndpoint,
    *,
    port: int = EPSON_NETWORK_PORT,
    vendor_name: str = "EPSON",
    model_name: str = MODEL_NAME,
    display_name: str | None = None,
) -> str:
    """Build the canonical Epson network URI shape exposed by XIOP."""

    endpoint = (
        host_or_endpoint
        if isinstance(host_or_endpoint, EpsonTcpIpEndpoint)
        else EpsonTcpIpEndpoint(
            host=host_or_endpoint,
            port=port,
            vendor_name=vendor_name,
            model_name=model_name,
            display_name=display_name,
        )
    )
    return (
        f'network epsontcpip://{endpoint.clean_host}/{endpoint.port} '
        f'"{endpoint.vendor_name} {endpoint.model_name}" "{endpoint.label}"'
    )


def endpoint_from_bonjour_service(service: ResolvedBonjourService) -> EpsonTcpIpEndpoint:
    vendor_name = service.txt.get("mfg", "EPSON")
    model_name = service.txt.get("mdl", MODEL_NAME)
    display_name = service.txt.get("ty") or f"{model_name} (IP)"
    return EpsonTcpIpEndpoint(
        host=service.host,
        port=service.port,
        vendor_name=vendor_name,
        model_name=model_name,
        display_name=display_name,
        service_name=service.instance_name,
        service_type=service.service_type,
        domain=service.domain,
        txt=dict(service.txt),
    )


def build_network_probe_frame(
    command: str,
    *,
    opcode: int = NETWORK_PASSTHROUGH_OPCODE,
    reply_length: int = ESCI2_IMMEDIATE_REPLY_SIZE,
) -> bytes:
    """Wrap a simple ESC/I-2 command in the current Epson network frame guess."""

    return build_network_passthrough_frame(
        opcode,
        build_header(command),
        reply_length=reply_length,
    )


def build_network_session_frame(opcode: int, payload: bytes = b"") -> bytes:
    """Build a non-passthrough Epson job-control frame."""

    return build_network_passthrough_frame(opcode, payload)


def probe_tcp_endpoint(
    host: str,
    *,
    port: int = EPSON_NETWORK_PORT,
    timeout: float = 2.0,
) -> TcpProbeResult:
    """Attempt a plain TCP connect to the Epson network scanner endpoint."""

    host_clean = host.rstrip(".")
    start = time.perf_counter()
    try:
        resolved_ip = socket.gethostbyname(host_clean)
        with socket.create_connection((host_clean, port), timeout=timeout):
            latency_ms = (time.perf_counter() - start) * 1000.0
        return TcpProbeResult(
            host=host_clean,
            port=port,
            reachable=True,
            timeout=timeout,
            latency_ms=latency_ms,
            resolved_ip=resolved_ip,
        )
    except OSError as exc:
        return TcpProbeResult(
            host=host_clean,
            port=port,
            reachable=False,
            timeout=timeout,
            error=f"{type(exc).__name__}: {exc}",
        )


def probe_tls_endpoint(
    host_or_endpoint: str | EpsonTcpIpEndpoint,
    *,
    port: int = EPSON_NETWORK_PORT,
    timeout: float = 2.0,
    verify_peer: bool = False,
    server_hostname: str | None = None,
) -> NetworkTlsProbeResult:
    """Attempt a ScanSmart-style TLS session startup on the Epson TCP endpoint."""

    endpoint = (
        host_or_endpoint
        if isinstance(host_or_endpoint, EpsonTcpIpEndpoint)
        else EpsonTcpIpEndpoint(host=host_or_endpoint, port=port)
    )
    start = time.perf_counter()
    tcp_connected = False
    target_hostname = server_hostname or endpoint.clean_host

    try:
        resolved_ip = socket.gethostbyname(endpoint.clean_host)
        with socket.create_connection((endpoint.clean_host, endpoint.port), timeout=timeout) as sock:
            tcp_connected = True
            sock.settimeout(timeout)
            context = ssl.create_default_context()
            if not verify_peer:
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
            with context.wrap_socket(sock, server_hostname=target_hostname) as tls_sock:
                latency_ms = (time.perf_counter() - start) * 1000.0
                cipher = tls_sock.cipher()
                peer_cert = tls_sock.getpeercert()
                subject_parts: list[str] = []
                if peer_cert:
                    for rdn in peer_cert.get("subject", ()):
                        for key, value in rdn:
                            subject_parts.append(f"{key}={value}")
                return NetworkTlsProbeResult(
                    endpoint=endpoint,
                    uri=build_epsontcpip_uri(endpoint),
                    timeout=timeout,
                    verify_peer=verify_peer,
                    server_hostname=target_hostname,
                    tcp_connected=True,
                    tls_established=True,
                    resolved_ip=resolved_ip,
                    latency_ms=latency_ms,
                    tls_version=tls_sock.version(),
                    cipher_suite=(cipher[0] if cipher else None),
                    peer_certificate_subject=", ".join(subject_parts) or None,
                )
    except (OSError, ssl.SSLError) as exc:
        return NetworkTlsProbeResult(
            endpoint=endpoint,
            uri=build_epsontcpip_uri(endpoint),
            timeout=timeout,
            verify_peer=verify_peer,
            server_hostname=target_hostname,
            tcp_connected=tcp_connected,
            tls_established=False,
            resolved_ip=resolved_ip if "resolved_ip" in locals() else None,
            latency_ms=(time.perf_counter() - start) * 1000.0,
            error=f"{type(exc).__name__}: {exc}",
        )


def send_network_probe(
    host: str,
    *,
    command: str,
    port: int = EPSON_NETWORK_PORT,
    timeout: float = 2.0,
    opcode: int = NETWORK_PASSTHROUGH_OPCODE,
    reply_length: int = ESCI2_IMMEDIATE_REPLY_SIZE,
    recv_limit: int = 4096,
) -> NetworkCommandProbeResult:
    """Send a wrapped ESC/I-2 probe over the Epson TCP endpoint."""

    host_clean = host.rstrip(".")
    frame = build_network_probe_frame(
        command,
        opcode=opcode,
        reply_length=reply_length,
    )

    start = time.perf_counter()
    try:
        resolved_ip = socket.gethostbyname(host_clean)
        with socket.create_connection((host_clean, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            sock.sendall(frame)
            response = sock.recv(recv_limit)
        latency_ms = (time.perf_counter() - start) * 1000.0
        parsed_reply = parse_network_reply(response) if response else None
        return NetworkCommandProbeResult(
            host=host_clean,
            port=port,
            command=command,
            opcode=opcode,
            reply_length=reply_length,
            sent_bytes=len(frame),
            response=response,
            timeout=timeout,
            resolved_ip=resolved_ip,
            latency_ms=latency_ms,
            parsed_reply=parsed_reply,
        )
    except (OSError, ProtocolError) as exc:
        return NetworkCommandProbeResult(
            host=host_clean,
            port=port,
            command=command,
            opcode=opcode,
            reply_length=reply_length,
            sent_bytes=len(frame),
            response=b"",
            timeout=timeout,
            error=f"{type(exc).__name__}: {exc}",
        )


def probe_network_greeting(
    host_or_endpoint: str | EpsonTcpIpEndpoint,
    *,
    port: int = EPSON_NETWORK_PORT,
    timeout: float = 2.0,
    linger: float = 0.1,
    recv_limit: int = 4096,
) -> NetworkGreetingProbeResult:
    """Connect, capture the initial Epson greeting frame, and observe socket state."""

    endpoint = (
        host_or_endpoint
        if isinstance(host_or_endpoint, EpsonTcpIpEndpoint)
        else EpsonTcpIpEndpoint(host=host_or_endpoint, port=port)
    )
    start = time.perf_counter()

    try:
        resolved_ip = socket.gethostbyname(endpoint.clean_host)
        with socket.create_connection((endpoint.clean_host, endpoint.port), timeout=timeout) as sock:
            greeting = _read_greeting_exchange(
                sock,
                recv_limit=recv_limit,
                timeout=timeout,
            )
            closed_after_greeting = _socket_closed_after_greeting(
                sock,
                linger=linger,
            )
        latency_ms = (time.perf_counter() - start) * 1000.0
        error = greeting.error if greeting is not None else None
        return NetworkGreetingProbeResult(
            endpoint=endpoint,
            uri=build_epsontcpip_uri(endpoint),
            timeout=timeout,
            greeting=greeting,
            closed_after_greeting=closed_after_greeting,
            resolved_ip=resolved_ip,
            latency_ms=latency_ms,
            error=error,
        )
    except OSError as exc:
        return NetworkGreetingProbeResult(
            endpoint=endpoint,
            uri=build_epsontcpip_uri(endpoint),
            timeout=timeout,
            greeting=None,
            closed_after_greeting=None,
            error=f"{type(exc).__name__}: {exc}",
        )


def start_network_session(
    host_or_endpoint: str | EpsonTcpIpEndpoint,
    *,
    port: int = EPSON_NETWORK_PORT,
    timeout: float = 2.0,
    commands: Iterable[str] = NETWORK_STARTUP_COMMANDS,
    lock: bool = True,
    unlock: bool = True,
    reply_length: int = ESCI2_IMMEDIATE_REPLY_SIZE,
    recv_limit: int = 4096,
    control_timeout: float = 0.25,
) -> NetworkStartupResult:
    """Run a minimal Epson network startup sequence on a single TCP connection."""

    endpoint = (
        host_or_endpoint
        if isinstance(host_or_endpoint, EpsonTcpIpEndpoint)
        else EpsonTcpIpEndpoint(host=host_or_endpoint, port=port)
    )
    exchanges: list[NetworkSessionExchange] = []
    start = time.perf_counter()

    try:
        resolved_ip = socket.gethostbyname(endpoint.clean_host)
        with socket.create_connection((endpoint.clean_host, endpoint.port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            greeting = _read_greeting_exchange(
                sock,
                recv_limit=recv_limit,
                timeout=timeout,
            )
            exchanges.append(greeting)
            if greeting.error is not None:
                raise OSError(greeting.error)
            if lock:
                exchanges.append(
                    _exchange_frame(
                        sock,
                        name="LOCK",
                        opcode=NETWORK_SESSION_LOCK_OPCODE,
                        request=build_network_session_frame(
                            NETWORK_SESSION_LOCK_OPCODE,
                            NETWORK_SESSION_LOCK_PAYLOAD,
                        ),
                        recv_limit=recv_limit,
                        timeout=control_timeout,
                        allow_timeout=True,
                        allow_eof=False,
                    )
                )
            for command in commands:
                exchange = _exchange_frame(
                    sock,
                    name=command,
                    opcode=NETWORK_PASSTHROUGH_OPCODE,
                    request=build_network_probe_frame(
                        command,
                        opcode=NETWORK_PASSTHROUGH_OPCODE,
                        reply_length=reply_length,
                    ),
                    recv_limit=recv_limit,
                    timeout=timeout,
                    allow_timeout=False,
                    allow_eof=False,
                )
                exchanges.append(exchange)
                if exchange.error is not None:
                    break
            if unlock:
                exchanges.append(
                    _exchange_frame(
                        sock,
                        name="UNLOCK",
                        opcode=NETWORK_SESSION_UNLOCK_OPCODE,
                        request=build_network_session_frame(NETWORK_SESSION_UNLOCK_OPCODE),
                        recv_limit=recv_limit,
                        timeout=control_timeout,
                        allow_timeout=True,
                        allow_eof=True,
                    )
                )
        latency_ms = (time.perf_counter() - start) * 1000.0
        error = next((item.error for item in exchanges if item.error is not None), None)
        return NetworkStartupResult(
            endpoint=endpoint,
            uri=build_epsontcpip_uri(endpoint),
            timeout=timeout,
            connected=True,
            exchanges=tuple(exchanges),
            resolved_ip=resolved_ip,
            latency_ms=latency_ms,
            error=error,
        )
    except OSError as exc:
        return NetworkStartupResult(
            endpoint=endpoint,
            uri=build_epsontcpip_uri(endpoint),
            timeout=timeout,
            connected=False,
            exchanges=tuple(exchanges),
            error=f"{type(exc).__name__}: {exc}",
        )


def parse_network_reply(block: bytes) -> ParsedNetworkReply:
    """Parse the current Epson network reply header guess for debugging."""

    if len(block) < 12:
        raise ProtocolError(f"network reply too short: expected >= 12 bytes, got {len(block)}")
    if block[:2] != b"IS":
        raise ProtocolError(f"unexpected network reply prefix: {block[:2]!r}")

    payload_length = int.from_bytes(block[6:10], "big")
    payload = block[12:]
    if len(payload) < payload_length:
        raise ProtocolError(
            f"network reply payload truncated: expected {payload_length} bytes, got {len(payload)}"
        )

    return ParsedNetworkReply(
        opcode=int.from_bytes(block[2:4], "big"),
        header_code=int.from_bytes(block[4:6], "big"),
        payload_length=payload_length,
        reserved=block[10:12],
        payload=payload[:payload_length],
    )


def parse_network_greeting(block: bytes) -> ParsedNetworkGreeting:
    """Interpret the initial connect-time Epson greeting frame.

    The payload layout is still an inference from live hardware. The current
    FF-680W greeting ends with a 16-byte sequence that cleanly decodes as a
    link-local IPv6 address.
    """

    reply = parse_network_reply(block)
    payload = reply.payload
    prefix = payload[:8]
    address_family_code = payload[6] if len(payload) >= 7 else None
    address_length = payload[7] if len(payload) >= 8 else None
    address_bytes = b""
    inferred_ipv6_address: str | None = None
    note: str | None = None

    if address_length is not None and len(payload) >= 8 + address_length:
        address_bytes = payload[8 : 8 + address_length]
        if address_length == 16:
            try:
                inferred_ipv6_address = str(IPv6Address(address_bytes))
                note = "Inference: greeting tail decodes as an IPv6 address."
            except AddressValueError:
                inferred_ipv6_address = None

    return ParsedNetworkGreeting(
        payload_prefix=prefix,
        address_family_code=address_family_code,
        address_length=address_length,
        address_bytes=address_bytes,
        inferred_ipv6_address=inferred_ipv6_address,
        note=note,
    )


def _exchange_frame(
    sock: socket.socket,
    *,
    name: str,
    opcode: int,
    request: bytes,
    recv_limit: int,
    timeout: float,
    allow_timeout: bool,
    allow_eof: bool,
) -> NetworkSessionExchange:
    previous_timeout = sock.gettimeout()
    sock.settimeout(timeout)
    try:
        sock.sendall(request)
        try:
            response = sock.recv(recv_limit)
        except socket.timeout as exc:
            if allow_timeout:
                return NetworkSessionExchange(
                    name=name,
                    opcode=opcode,
                    request=request,
                    response=b"",
                )
            return NetworkSessionExchange(
                name=name,
                opcode=opcode,
                request=request,
                response=b"",
                error=f"{type(exc).__name__}: {exc}",
            )
        if not response and not allow_eof:
            return NetworkSessionExchange(
                name=name,
                opcode=opcode,
                request=request,
                response=b"",
                error="peer closed connection",
            )
        parsed_reply = parse_network_reply(response) if response else None
        return NetworkSessionExchange(
            name=name,
            opcode=opcode,
            request=request,
            response=response,
            parsed_reply=parsed_reply,
        )
    except (OSError, ProtocolError) as exc:
        return NetworkSessionExchange(
            name=name,
            opcode=opcode,
            request=request,
            response=b"",
            error=f"{type(exc).__name__}: {exc}",
        )
    finally:
        sock.settimeout(previous_timeout)


def _read_greeting_exchange(
    sock: socket.socket,
    *,
    recv_limit: int,
    timeout: float,
) -> NetworkSessionExchange:
    previous_timeout = sock.gettimeout()
    sock.settimeout(timeout)
    try:
        response = sock.recv(recv_limit)
        if not response:
            return NetworkSessionExchange(
                name="GREETING",
                opcode=0,
                request=b"",
                response=b"",
                error="empty greeting",
            )
        parsed_reply = parse_network_reply(response)
        parsed_greeting = parse_network_greeting(response)
        return NetworkSessionExchange(
            name="GREETING",
            opcode=parsed_reply.opcode,
            request=b"",
            response=response,
            parsed_reply=parsed_reply,
            parsed_greeting=parsed_greeting,
        )
    except (OSError, ProtocolError) as exc:
        return NetworkSessionExchange(
            name="GREETING",
            opcode=0,
            request=b"",
            response=b"",
            error=f"{type(exc).__name__}: {exc}",
        )
    finally:
        sock.settimeout(previous_timeout)


def _socket_closed_after_greeting(sock: socket.socket, *, linger: float) -> bool | None:
    previous_timeout = sock.gettimeout()
    sock.settimeout(linger)
    try:
        data = sock.recv(1, socket.MSG_PEEK)
        return data == b""
    except TimeoutError:
        return False
    except OSError:
        return None
    finally:
        sock.settimeout(previous_timeout)
