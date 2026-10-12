"""Command-line entrypoints for low-level device work."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable

from .constants import EPSON_NETWORK_PORT, FF680W_PRODUCT_ID, FF680W_VENDOR_ID, MODEL_NAME
from .errors import FF680WError
from .profiles import default_ff680w_gray_jpeg_scan_plan
from .scan import run_gray_scan_probe, run_jpeg_scan
from .session import EscI2Session
from .settings import read_scanner_settings
from .transports.network import (
    EpsonTcpIpEndpoint,
    EventManagerNetworkSettings,
    NetworkTransportStatus,
    NETWORK_STARTUP_COMMANDS,
    WebConfigStatus,
    build_epsontcpip_uri,
    build_network_probe_frame,
    discover_scanners,
    endpoint_from_bonjour_service,
    format_snmp_value,
    local_wifi_hints,
    probe_network_pair_state,
    probe_scanner_snmp,
    probe_network_greeting,
    probe_tcp_endpoint,
    probe_tls_endpoint,
    probe_webconfig_state,
    read_event_manager_network_settings,
    resolve_bonjour_service,
    send_network_probe,
    start_network_session,
)
from .transports.usb import UsbTransport, discover_usb_candidates, reset_usb_device
from .vendor_data import vendor_summary


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.main_command == "probe-usb":
            return cmd_probe_usb()
        if args.main_command == "usb":
            return cmd_usb(args)
        if args.main_command == "net":
            return cmd_net(args)
    except FF680WError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    parser.print_help()
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ff680w")
    sub = parser.add_subparsers(dest="main_command")

    sub.add_parser("probe-usb", help="list matching or nearby USB devices")

    usb_parser = sub.add_parser("usb", help="send low-level USB queries")
    usb_parser.add_argument(
        "--serial",
        help="optional USB serial number to disambiguate devices",
    )
    usb_sub = usb_parser.add_subparsers(dest="usb_command", required=True)
    usb_sub.add_parser("info", help="run INFO")
    usb_sub.add_parser("status", help="run STAT")
    usb_sub.add_parser("capabilities", help="run CAPA")
    usb_sub.add_parser("resolutions", help="run RESA")
    usb_sub.add_parser("settings", help="read device identity, capabilities and current settings as JSON")
    usb_sub.add_parser("load", help="run MECH #ADFLOAD")
    plan_gray = usb_sub.add_parser(
        "plan-gray",
        help="show the vendor-driven FF-680W grayscale JPEG scan plan",
    )
    plan_gray.add_argument("--dpi", type=int, default=300, help="input DPI")
    plan_gray.add_argument(
        "--buffer-size",
        type=int,
        default=65536,
        help="scan buffer size advertised in the PARA block",
    )
    usb_sub.add_parser("vendor-summary", help="show vendored Epson FF-680W model data")
    usb_sub.add_parser("reset", help="reset the USB device via libusb")
    scan = usb_sub.add_parser("scan", help="scan color or grayscale JPEGs, one file per sheet side")
    scan.add_argument("--mode", choices=("color", "gray"), default="color")
    scan.add_argument("--duplex", action="store_true", help="scan both sides")
    scan.add_argument("--output-dir", help="new directory for numbered front/back images")
    scan.add_argument("--timeout", type=float, default=120, help="job timeout in seconds")
    scan.add_argument("--dpi", type=int, default=300, help="device acquisition DPI, 50–600")
    scan.add_argument("--sheets", type=int, default=0, help="physical sheet limit; 0 scans the whole feeder")
    scan.add_argument("--paper", choices=("letter", "a4", "legal"), default="letter")
    scan.add_argument("--quality", type=int, default=90, help="JPEG quality, 1–100")
    scan.add_argument("--deskew", action="store_true", help="enable device paper-skew correction")
    scan.add_argument("--auto-crop", action="store_true", help="device crop with paper-end detection")
    scan.add_argument("--no-double-feed", action="store_true", help="disable double-feed detection")
    scan_gray = usb_sub.add_parser(
        "scan-gray",
        help="experimental FF-680W grayscale JPEG scan probe",
    )
    scan_gray.add_argument(
        "--output",
        default="ff680w-scan-gray.jpg",
        help="where to write the collected JPEG bytes",
    )
    scan_gray.add_argument(
        "--polls",
        type=int,
        default=200,
        help="maximum IMG polls before giving up",
    )
    scan_gray.add_argument(
        "--delay-ms",
        type=int,
        default=100,
        help="optional delay between IMG polls",
    )
    scan_gray.add_argument(
        "--skip-mechanical",
        action="store_true",
        help="skip the vendor-driven default ADF MECH action sequence",
    )
    trace = usb_sub.add_parser("trace", help="send an arbitrary 4-char ESC/I-2 command")
    trace.add_argument(
        "--command",
        dest="esc_command",
        required=True,
        help="4-char command, e.g. INFO or TRDT",
    )

    net_parser = sub.add_parser("net", help="show current network-mode scaffold status")
    net_sub = net_parser.add_subparsers(dest="net_command", required=True)
    net_sub.add_parser("status", help="describe the current network scaffold")
    hints = net_sub.add_parser("hints", help="show local Wi-Fi discovery hints from XIOP")
    hints.add_argument(
        "--host",
        default="192.168.1.2",
        help="sample host used to format the example Epson URI",
    )
    discover = net_sub.add_parser(
        "discover",
        help="browse and resolve local scanner services via dns-sd",
    )
    discover.add_argument(
        "--service",
        action="append",
        dest="services",
        help="service type to browse, defaults to _scanner._tcp and _uscan._tcp",
    )
    discover.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    discover.add_argument(
        "--timeout",
        type=float,
        default=2.5,
        help="browse/resolve timeout in seconds",
    )
    resolve = net_sub.add_parser("resolve", help="resolve a single Bonjour scanner service")
    resolve.add_argument("--name", required=True, help="Bonjour instance name")
    resolve.add_argument(
        "--service",
        default="_scanner._tcp",
        help="Bonjour service type, default _scanner._tcp",
    )
    resolve.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    resolve.add_argument(
        "--timeout",
        type=float,
        default=2.5,
        help="resolve timeout in seconds",
    )
    greeting = net_sub.add_parser(
        "greeting",
        help="connect and parse the initial Epson network greeting",
    )
    greeting_target = greeting.add_mutually_exclusive_group(required=True)
    greeting_target.add_argument("--host", help="scanner IP or Bonjour hostname")
    greeting_target.add_argument(
        "--name",
        help="Bonjour instance name, e.g. EPSON FF-680W",
    )
    greeting.add_argument(
        "--service",
        default="_scanner._tcp",
        help="Bonjour service type, default _scanner._tcp",
    )
    greeting.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    greeting.add_argument(
        "--port",
        type=int,
        default=EPSON_NETWORK_PORT,
        help="scanner TCP port when using --host",
    )
    greeting.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="socket timeout in seconds",
    )
    greeting.add_argument(
        "--linger",
        type=float,
        default=0.1,
        help="short delay used to see whether the socket closes after greeting",
    )
    endpoint = net_sub.add_parser(
        "endpoint",
        help="resolve a scanner endpoint and print the Epson URI metadata",
    )
    endpoint_target = endpoint.add_mutually_exclusive_group(required=True)
    endpoint_target.add_argument("--host", help="scanner IP or Bonjour hostname")
    endpoint_target.add_argument(
        "--name",
        help="Bonjour instance name, e.g. EPSON FF-680W",
    )
    endpoint.add_argument(
        "--service",
        default="_scanner._tcp",
        help="Bonjour service type, default _scanner._tcp",
    )
    endpoint.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    endpoint.add_argument(
        "--timeout",
        type=float,
        default=2.5,
        help="resolve timeout in seconds",
    )
    uri = net_sub.add_parser("uri", help="build an Epson local Wi-Fi URI")
    uri.add_argument("--host", required=True, help="scanner IP or hostname")
    uri.add_argument("--port", type=int, default=EPSON_NETWORK_PORT, help="scanner port")
    tcp_probe = net_sub.add_parser("tcp-probe", help="attempt a raw TCP connect to the scanner")
    tcp_probe.add_argument("--host", required=True, help="scanner IP or Bonjour hostname")
    tcp_probe.add_argument(
        "--port",
        type=int,
        default=EPSON_NETWORK_PORT,
        help="scanner TCP port",
    )
    tcp_probe.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="socket timeout in seconds",
    )
    tls_probe = net_sub.add_parser(
        "tls-probe",
        help="attempt the ScanSmart-style TLS setup on port 1865",
    )
    tls_target = tls_probe.add_mutually_exclusive_group(required=True)
    tls_target.add_argument("--host", help="scanner IP or Bonjour hostname")
    tls_target.add_argument(
        "--name",
        help="Bonjour instance name, e.g. EPSON FF-680W",
    )
    tls_probe.add_argument(
        "--service",
        default="_scanner._tcp",
        help="Bonjour service type, default _scanner._tcp",
    )
    tls_probe.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    tls_probe.add_argument(
        "--port",
        type=int,
        default=EPSON_NETWORK_PORT,
        help="scanner TCP port when using --host",
    )
    tls_probe.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="socket timeout in seconds",
    )
    tls_probe.add_argument(
        "--server-hostname",
        help="optional TLS SNI name, defaults to the resolved host",
    )
    tls_probe.add_argument(
        "--verify-peer",
        action="store_true",
        help="enable certificate verification instead of probe-mode trust",
    )
    wrap = net_sub.add_parser("wrap", help="build a raw Epson network probe frame")
    wrap.add_argument(
        "--command",
        dest="esc_command",
        required=True,
        help="4-char ESC/I-2 command, e.g. INFO",
    )
    wrap.add_argument(
        "--opcode",
        type=lambda value: int(value, 0),
        default=0x2000,
        help="network opcode, default 0x2000",
    )
    wrap.add_argument(
        "--reply-length",
        type=int,
        default=64,
        help="expected ESC/I-2 immediate reply length",
    )
    send_probe = net_sub.add_parser(
        "send-probe",
        help="connect and send a wrapped ESC/I-2 probe over Wi-Fi",
    )
    send_probe.add_argument("--host", required=True, help="scanner IP or Bonjour hostname")
    send_probe.add_argument(
        "--port",
        type=int,
        default=EPSON_NETWORK_PORT,
        help="scanner TCP port",
    )
    send_probe.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="socket timeout in seconds",
    )
    send_probe.add_argument(
        "--command",
        dest="esc_command",
        required=True,
        help="4-char ESC/I-2 command, e.g. INFO",
    )
    send_probe.add_argument(
        "--opcode",
        type=lambda value: int(value, 0),
        default=0x2000,
        help="network opcode, default 0x2000",
    )
    send_probe.add_argument(
        "--reply-length",
        type=int,
        default=64,
        help="expected ESC/I-2 immediate reply length",
    )
    startup = net_sub.add_parser(
        "startup",
        help="run a minimal Epson TCP session startup sequence",
    )
    startup_target = startup.add_mutually_exclusive_group(required=True)
    startup_target.add_argument("--host", help="scanner IP or Bonjour hostname")
    startup_target.add_argument(
        "--name",
        help="Bonjour instance name, e.g. EPSON FF-680W",
    )
    startup.add_argument(
        "--service",
        default="_scanner._tcp",
        help="Bonjour service type, default _scanner._tcp",
    )
    startup.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    startup.add_argument(
        "--port",
        type=int,
        default=EPSON_NETWORK_PORT,
        help="scanner TCP port when using --host",
    )
    startup.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="socket timeout in seconds",
    )
    startup.add_argument(
        "--control-timeout",
        type=float,
        default=0.25,
        help="short timeout for job-control frames like lock/unlock",
    )
    startup.add_argument(
        "--command",
        dest="startup_commands",
        action="append",
        help="startup command to send after lock, default INFO then STAT",
    )
    startup.add_argument(
        "--no-default-commands",
        action="store_true",
        help="send only greeting and control frames unless --command is provided",
    )
    startup.add_argument(
        "--skip-lock",
        action="store_true",
        help="skip the 0x2100 job lock frame",
    )
    startup.add_argument(
        "--skip-unlock",
        action="store_true",
        help="skip the 0x2101 job unlock frame",
    )
    startup.add_argument(
        "--reply-length",
        type=int,
        default=64,
        help="expected ESC/I-2 immediate reply length",
    )
    snmp = net_sub.add_parser(
        "snmp",
        help="query the Epson enterprise SNMP leaves used by the local apps",
    )
    snmp_target = snmp.add_mutually_exclusive_group(required=True)
    snmp_target.add_argument("--host", help="scanner IP or Bonjour hostname")
    snmp_target.add_argument(
        "--name",
        help="Bonjour instance name, e.g. EPSON FF-680W",
    )
    snmp.add_argument(
        "--service",
        default="_scanner._tcp",
        help="Bonjour service type, default _scanner._tcp",
    )
    snmp.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    snmp.add_argument(
        "--port",
        type=int,
        default=EPSON_NETWORK_PORT,
        help="scanner TCP port when using --host",
    )
    snmp.add_argument(
        "--community",
        default="public",
        help="SNMP community string, default public",
    )
    snmp.add_argument(
        "--version",
        default="1",
        help="SNMP version for snmpget, default 1",
    )
    snmp.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="per-OID SNMP timeout in seconds",
    )
    net_sub.add_parser(
        "event-manager-state",
        help="read Event Manager's local network-scan settings and log message",
    )
    webconfig = net_sub.add_parser(
        "webconfig-state",
        help="probe the scanner WebConfig gate and detect forced-password setup",
    )
    webconfig_target = webconfig.add_mutually_exclusive_group(required=True)
    webconfig_target.add_argument("--host", help="scanner IP or Bonjour hostname")
    webconfig_target.add_argument(
        "--name",
        help="Bonjour instance name, e.g. EPSON FF-680W",
    )
    webconfig.add_argument(
        "--service",
        default="_scanner._tcp",
        help="Bonjour service type, default _scanner._tcp",
    )
    webconfig.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    webconfig.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="HTTPS probe timeout in seconds",
    )
    pair_state = net_sub.add_parser(
        "pair-state",
        help="show the combined Bonjour, Event Manager, WebConfig, and SNMP state",
    )
    pair_state_target = pair_state.add_mutually_exclusive_group(required=True)
    pair_state_target.add_argument("--host", help="scanner IP or Bonjour hostname")
    pair_state_target.add_argument(
        "--name",
        help="Bonjour instance name, e.g. EPSON FF-680W",
    )
    pair_state.add_argument(
        "--service",
        default="_scanner._tcp",
        help="Bonjour service type, default _scanner._tcp",
    )
    pair_state.add_argument(
        "--domain",
        default="local.",
        help="Bonjour domain, default local.",
    )
    pair_state.add_argument(
        "--port",
        type=int,
        default=EPSON_NETWORK_PORT,
        help="scanner TCP port when using --host",
    )
    pair_state.add_argument(
        "--community",
        default="public",
        help="SNMP community string, default public",
    )
    pair_state.add_argument(
        "--version",
        default="1",
        help="SNMP version for snmpget, default 1",
    )
    pair_state.add_argument(
        "--timeout",
        type=float,
        default=2.0,
        help="probe timeout in seconds",
    )

    return parser


def cmd_probe_usb() -> int:
    candidates = discover_usb_candidates()
    if not candidates:
        print("No USB devices were found or pyusb/libusb is unavailable.")
        return 0

    for candidate in candidates:
        exact = (
            candidate.vendor_id == FF680W_VENDOR_ID
            and candidate.product_id == FF680W_PRODUCT_ID
        )
        marker = "*" if exact else "-"
        print(
            f"{marker} vid=0x{candidate.vendor_id:04x} pid=0x{candidate.product_id:04x} "
            f"manufacturer={candidate.manufacturer or '?'} "
            f"product={candidate.product or '?'} "
            f"serial={candidate.serial_number or '?'} "
            f"bus={candidate.bus if candidate.bus is not None else '?'} "
            f"address={candidate.address if candidate.address is not None else '?'}"
        )

    return 0


def cmd_usb(args: argparse.Namespace) -> int:
    if args.usb_command == "vendor-summary":
        print_vendor_summary()
        return 0
    if args.usb_command == "plan-gray":
        plan = default_ff680w_gray_jpeg_scan_plan(
            dpi=args.dpi,
            buffer_size=args.buffer_size,
        )
        print_scan_plan(plan)
        return 0

    if args.usb_command == "reset":
        reset_usb_device(
            vendor_id=FF680W_VENDOR_ID,
            product_id=FF680W_PRODUCT_ID,
            serial_number=args.serial,
        )
        print("reset=ok")
        return 0

    transport = UsbTransport(
        vendor_id=FF680W_VENDOR_ID,
        product_id=FF680W_PRODUCT_ID,
        serial_number=args.serial,
    )
    session = EscI2Session(transport)
    locked = False
    session.open()
    try:
        session.lock()
        locked = True

        if args.usb_command == "info":
            reply = session.info()
        elif args.usb_command == "status":
            reply = session.status()
        elif args.usb_command == "capabilities":
            reply = session.capabilities()
        elif args.usb_command == "resolutions":
            reply = session.resolutions()
        elif args.usb_command == "settings":
            print(json.dumps(read_scanner_settings(session), indent=2))
            return 0
        elif args.usb_command == "load":
            reply = session.mechanical("#ADFLOAD")
        elif args.usb_command == "scan":
            output_dir = Path(args.output_dir or (
                "scans/" + datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            )).resolve()
            images = run_jpeg_scan(
                session, output_dir=output_dir, mode=args.mode,
                duplex=args.duplex, timeout=args.timeout,
                dpi=args.dpi, max_sheets=args.sheets, paper=args.paper,
                quality=args.quality, deskew=args.deskew, auto_crop=args.auto_crop,
                double_feed=not args.no_double_feed,
            )
            print(f"mode={args.mode}")
            print(f"duplex={args.duplex}")
            print(f"dpi={args.dpi}")
            print(f"sheets={len(images) // (2 if args.duplex else 1)}")
            print(f"images={len(images)}")
            for image in images:
                print(f"sheet={image.sheet} side={image.side} bytes={image.size} output={image.path}")
            return 0
        elif args.usb_command == "scan-gray":
            result = run_gray_scan_probe(
                session,
                output_path=Path(args.output).resolve(),
                polls=args.polls,
                delay_ms=args.delay_ms,
                run_mechanical=not args.skip_mechanical,
            )
            print(f"mechanical_ok={result.mechanical_ok}")
            print(f"para_ok={result.para_ok}")
            print(f"trdt_ok={result.trdt_ok}")
            print(f"image_bytes={result.image_bytes}")
            print(f"output={result.output_path}")
            print_scan_plan(result.plan)
            if result.block_headers:
                print(f"first_header={result.block_headers[0]}")
                print(f"last_header={result.block_headers[-1]}")
            if result.terminal_tokens:
                print(f"terminal_tokens={','.join(result.terminal_tokens)}")
            return 0
        elif args.usb_command == "trace":
            reply = session.trace(args.esc_command)
        else:
            raise FF680WError(f"unsupported usb command: {args.usb_command}")

        print_reply(reply.tokens, reply.header_block, reply.data_block, reply.extra_length)
        return 0
    finally:
        if locked:
            try:
                session.unlock()
            except FF680WError:
                pass
        session.close()


def cmd_net(args: argparse.Namespace) -> int:
    if args.net_command == "status":
        status = NetworkTransportStatus()
        print(f"model={MODEL_NAME}")
        print(f"implemented={status.implemented}")
        print(f"port={status.port}")
        print(f"bonjour_services={','.join(status.bonjour_services)}")
        print(
            "alternate_bonjour_services="
            f"{','.join(status.alternate_bonjour_services)}"
        )
        print(f"uri_formats={len(status.uri_formats)}")
        print(f"source_path={status.source_path}")
        print(f"dns_sd_path={status.dns_sd_path or 'missing'}")
        print(f"snmpget_path={status.snmpget_path or 'missing'}")
        print(f"note={status.note}")
        return 0
    if args.net_command == "hints":
        hints = local_wifi_hints(args.host)
        print(f"port={hints.port}")
        print(f"bonjour_services={','.join(hints.bonjour_services)}")
        print(
            "alternate_bonjour_services="
            f"{','.join(hints.alternate_bonjour_services)}"
        )
        print(f"example_uri={hints.example_uri}")
        print(f"source_path={hints.source_path}")
        print(f"event_manager_settings_path={hints.event_manager_settings_path}")
        print(f"event_manager_log_path={hints.event_manager_log_path}")
        print(f"snmpget_path={hints.snmpget_path or 'missing'}")
        for index, uri_format in enumerate(hints.uri_formats, start=1):
            print(f"uri_format_{index}={uri_format}")
        return 0
    if args.net_command == "discover":
        services = discover_scanners(
            service_types=tuple(args.services) if args.services else None,
            domain=args.domain,
            timeout=args.timeout,
        )
        print(f"services={len(services)}")
        for index, service in enumerate(services, start=1):
            print_resolved_service(service, index)
        return 0
    if args.net_command == "resolve":
        service = resolve_bonjour_service(
            args.name,
            args.service,
            domain=args.domain,
            timeout=args.timeout,
        )
        if service is None:
            print("resolved=false")
            return 0
        print("resolved=true")
        print_resolved_service(service)
        return 0
    if args.net_command == "greeting":
        endpoint = resolve_endpoint(
            host=args.host,
            name=args.name,
            service_type=args.service,
            domain=args.domain,
            timeout=args.timeout,
            port=args.port,
        )
        result = probe_network_greeting(
            endpoint,
            timeout=args.timeout,
            linger=args.linger,
        )
        print_endpoint(result.endpoint)
        print(f"timeout={result.timeout}")
        print(f"linger={args.linger}")
        if result.resolved_ip is not None:
            print(f"resolved_ip={result.resolved_ip}")
        if result.latency_ms is not None:
            print(f"latency_ms={result.latency_ms:.2f}")
        if result.greeting is not None:
            print_exchange(result.greeting, index=1)
        if result.closed_after_greeting is not None:
            print(f"closed_after_greeting={result.closed_after_greeting}")
        if result.error is not None:
            print(f"error={result.error}")
        return 0
    if args.net_command == "endpoint":
        endpoint = resolve_endpoint(
            host=args.host,
            name=args.name,
            service_type=args.service,
            domain=args.domain,
            timeout=args.timeout,
            port=getattr(args, "port", EPSON_NETWORK_PORT),
        )
        print_endpoint(endpoint)
        return 0
    if args.net_command == "uri":
        print(build_epsontcpip_uri(args.host, port=args.port))
        return 0
    if args.net_command == "tcp-probe":
        result = probe_tcp_endpoint(
            args.host,
            port=args.port,
            timeout=args.timeout,
        )
        print(f"reachable={result.reachable}")
        print(f"host={result.host}")
        print(f"port={result.port}")
        print(f"timeout={result.timeout}")
        if result.resolved_ip is not None:
            print(f"resolved_ip={result.resolved_ip}")
        if result.latency_ms is not None:
            print(f"latency_ms={result.latency_ms:.2f}")
        if result.error is not None:
            print(f"error={result.error}")
        return 0
    if args.net_command == "tls-probe":
        endpoint = resolve_endpoint(
            host=args.host,
            name=args.name,
            service_type=args.service,
            domain=args.domain,
            timeout=args.timeout,
            port=args.port,
        )
        result = probe_tls_endpoint(
            endpoint,
            timeout=args.timeout,
            verify_peer=args.verify_peer,
            server_hostname=args.server_hostname,
        )
        print_endpoint(result.endpoint)
        print(f"timeout={result.timeout}")
        print(f"verify_peer={result.verify_peer}")
        print(f"server_hostname={result.server_hostname}")
        print(f"tcp_connected={result.tcp_connected}")
        print(f"tls_established={result.tls_established}")
        if result.resolved_ip is not None:
            print(f"resolved_ip={result.resolved_ip}")
        if result.latency_ms is not None:
            print(f"latency_ms={result.latency_ms:.2f}")
        if result.tls_version is not None:
            print(f"tls_version={result.tls_version}")
        if result.cipher_suite is not None:
            print(f"cipher_suite={result.cipher_suite}")
        if result.peer_certificate_subject is not None:
            print(f"peer_certificate_subject={result.peer_certificate_subject}")
        if result.error is not None:
            print(f"error={result.error}")
        return 0
    if args.net_command == "wrap":
        frame = build_network_probe_frame(
            args.esc_command,
            opcode=args.opcode,
            reply_length=args.reply_length,
        )
        print(f"length={len(frame)}")
        print(f"frame_hex={frame.hex()}")
        return 0
    if args.net_command == "send-probe":
        result = send_network_probe(
            args.host,
            port=args.port,
            timeout=args.timeout,
            command=args.esc_command,
            opcode=args.opcode,
            reply_length=args.reply_length,
        )
        print(f"host={result.host}")
        print(f"port={result.port}")
        print(f"command={result.command}")
        print(f"opcode=0x{result.opcode:04x}")
        print(f"reply_length={result.reply_length}")
        print(f"timeout={result.timeout}")
        if result.resolved_ip is not None:
            print(f"resolved_ip={result.resolved_ip}")
        if result.latency_ms is not None:
            print(f"latency_ms={result.latency_ms:.2f}")
        print(f"sent_bytes={result.sent_bytes}")
        print(f"response_bytes={len(result.response)}")
        if result.response:
            print(f"response_hex={result.response.hex()}")
        if result.parsed_reply is not None:
            print(f"reply_opcode=0x{result.parsed_reply.opcode:04x}")
            print(f"reply_header_code=0x{result.parsed_reply.header_code:04x}")
            print(f"reply_payload_length={result.parsed_reply.payload_length}")
            print(f"reply_reserved={result.parsed_reply.reserved.hex()}")
            print(f"reply_payload_hex={result.parsed_reply.payload.hex()}")
        if result.error is not None:
            print(f"error={result.error}")
        return 0
    if args.net_command == "startup":
        endpoint = resolve_endpoint(
            host=args.host,
            name=args.name,
            service_type=args.service,
            domain=args.domain,
            timeout=args.timeout,
            port=args.port,
        )
        result = start_network_session(
            endpoint,
            timeout=args.timeout,
            commands=tuple(
                args.startup_commands
                or (() if args.no_default_commands else NETWORK_STARTUP_COMMANDS)
            ),
            lock=not args.skip_lock,
            unlock=not args.skip_unlock,
            reply_length=args.reply_length,
            control_timeout=args.control_timeout,
        )
        print(f"connected={result.connected}")
        print_endpoint(result.endpoint)
        print(f"timeout={result.timeout}")
        if result.resolved_ip is not None:
            print(f"resolved_ip={result.resolved_ip}")
        if result.latency_ms is not None:
            print(f"latency_ms={result.latency_ms:.2f}")
        print(f"exchanges={len(result.exchanges)}")
        for index, exchange in enumerate(result.exchanges, start=1):
            print_exchange(exchange, index=index)
        if result.error is not None:
            print(f"error={result.error}")
        return 0
    if args.net_command == "snmp":
        endpoint = resolve_endpoint(
            host=args.host,
            name=args.name,
            service_type=args.service,
            domain=args.domain,
            timeout=args.timeout,
            port=args.port,
        )
        snapshot = probe_scanner_snmp(
            endpoint.clean_host,
            community=args.community,
            version=args.version,
            timeout=args.timeout,
        )
        print(f"host={snapshot.host}")
        print(f"community={snapshot.community}")
        print(f"version={snapshot.version}")
        print(f"timeout={snapshot.timeout}")
        print(f"tool_path={snapshot.tool_path}")
        if snapshot.resolved_ip is not None:
            print(f"resolved_ip={snapshot.resolved_ip}")
        for value in snapshot.values:
            print(f"{value.name}_oid={value.oid}")
            if value.value_type is not None:
                print(f"{value.name}_type={value.value_type}")
            if value.error is not None:
                print(f"{value.name}_error={value.error}")
            else:
                print(f"{value.name}={format_snmp_value(value.value)}")
        if snapshot.error is not None:
            print(f"error={snapshot.error}")
        return 0
    if args.net_command == "event-manager-state":
        print_event_manager_state(read_event_manager_network_settings())
        return 0
    if args.net_command == "webconfig-state":
        endpoint = resolve_endpoint(
            host=args.host,
            name=args.name,
            service_type=args.service,
            domain=args.domain,
            timeout=args.timeout,
            port=getattr(args, "port", EPSON_NETWORK_PORT),
        )
        print_endpoint(endpoint)
        print_webconfig_status(
            probe_webconfig_state(endpoint.clean_host, timeout=args.timeout)
        )
        return 0
    if args.net_command == "pair-state":
        endpoint = resolve_endpoint(
            host=args.host,
            name=args.name,
            service_type=args.service,
            domain=args.domain,
            timeout=args.timeout,
            port=args.port,
        )
        state = probe_network_pair_state(
            endpoint,
            community=args.community,
            version=args.version,
            timeout=args.timeout,
        )
        print_endpoint(state.endpoint)
        print(f"bonjour_scanner_available={state.bonjour_scanner_available or ''}")
        print(f"bonjour_adminurl={state.bonjour_adminurl or ''}")
        print_event_manager_state(state.event_manager)
        print_webconfig_status(state.webconfig)
        for value in state.snmp.values:
            if value.error is not None:
                print(f"snmp_{value.name}_error={value.error}")
            else:
                print(f"snmp_{value.name}={format_snmp_value(value.value)}")
        if state.session_address is not None:
            print(f"session_address={state.session_address}")
        if state.session_address_matches_local_interface is not None:
            print(
                "session_address_matches_local_interface="
                f"{state.session_address_matches_local_interface}"
            )
        if state.session_address_interface is not None:
            print(f"session_address_interface={state.session_address_interface}")
        if state.snmp.error is not None:
            print(f"snmp_error={state.snmp.error}")
        return 0

    raise FF680WError(f"unsupported net command: {args.net_command}")


def print_reply(tokens: Iterable, header_block: bytes, data_block: bytes, extra_length: int) -> None:
    print(f"header={header_block[:12]!r}")
    print(f"extra_length={extra_length}")
    if data_block:
        print(f"data_block_bytes={len(data_block)}")
    for token in tokens:
        print(f"{token.name}={token.text}")


def resolve_endpoint(
    *,
    host: str | None,
    name: str | None,
    service_type: str,
    domain: str,
    timeout: float,
    port: int,
) -> EpsonTcpIpEndpoint:
    if host:
        return EpsonTcpIpEndpoint(host=host, port=port)

    assert name is not None
    service = resolve_bonjour_service(
        name,
        service_type,
        domain=domain,
        timeout=timeout,
    )
    if service is None:
        raise FF680WError(f"could not resolve Bonjour service {name!r} on {service_type}")
    return endpoint_from_bonjour_service(service)


def print_endpoint(endpoint: EpsonTcpIpEndpoint) -> None:
    print(f"host={endpoint.clean_host}")
    print(f"port={endpoint.port}")
    print(f"vendor_name={endpoint.vendor_name}")
    print(f"model_name={endpoint.model_name}")
    print(f"display_name={endpoint.label}")
    if endpoint.service_name is not None:
        print(f"service_name={endpoint.service_name}")
    print(f"service_type={endpoint.service_type}")
    print(f"domain={endpoint.domain}")
    print(f"uri={build_epsontcpip_uri(endpoint)}")


def print_exchange(exchange, *, index: int) -> None:
    print(f"exchange_{index}_name={exchange.name}")
    print(f"exchange_{index}_opcode=0x{exchange.opcode:04x}")
    print(f"exchange_{index}_request_hex={exchange.request.hex()}")
    print(f"exchange_{index}_response_bytes={len(exchange.response)}")
    if exchange.response:
        print(f"exchange_{index}_response_hex={exchange.response.hex()}")
    if exchange.parsed_reply is not None:
        print(f"exchange_{index}_reply_opcode=0x{exchange.parsed_reply.opcode:04x}")
        print(
            f"exchange_{index}_reply_header_code=0x{exchange.parsed_reply.header_code:04x}"
        )
        print(f"exchange_{index}_reply_payload_length={exchange.parsed_reply.payload_length}")
        print(f"exchange_{index}_reply_payload_hex={exchange.parsed_reply.payload.hex()}")
    if exchange.parsed_greeting is not None:
        print(f"exchange_{index}_greeting_prefix={exchange.parsed_greeting.payload_prefix.hex()}")
        if exchange.parsed_greeting.address_family_code is not None:
            print(
                "exchange_"
                f"{index}_greeting_address_family_code={exchange.parsed_greeting.address_family_code}"
            )
        if exchange.parsed_greeting.address_length is not None:
            print(
                "exchange_"
                f"{index}_greeting_address_length={exchange.parsed_greeting.address_length}"
            )
        if exchange.parsed_greeting.address_bytes:
            print(
                "exchange_"
                f"{index}_greeting_address_bytes={exchange.parsed_greeting.address_bytes.hex()}"
            )
        if exchange.parsed_greeting.inferred_ipv6_address is not None:
            print(
                "exchange_"
                f"{index}_greeting_ipv6={exchange.parsed_greeting.inferred_ipv6_address}"
            )
        if exchange.parsed_greeting.note is not None:
            print(f"exchange_{index}_greeting_note={exchange.parsed_greeting.note}")
    if exchange.error is not None:
        print(f"exchange_{index}_error={exchange.error}")


def print_vendor_summary() -> None:
    summary = vendor_summary()
    print(f"model={summary['model_name']}")
    print(f"model_id={summary['model_id']}")
    print(f"product_id={summary['product_id']}")
    print(f"command_type={summary['command_type']}")
    print(f"connection_type={summary['connection_type']}")
    print(f"document_mode={summary['document_mode']}")
    print(f"default_scan_mode={summary['default_scan_mode']}")
    print(f"carrier_sheet_mode={summary['carrier_sheet_mode']}")
    print(f"auto_detect_long_paper={summary['auto_detect_long_paper']}")
    print(
        "default_double_feed_detection="
        f"{summary['default_double_feed_detection']}"
    )
    print(f"profile_table_id={summary['profile_table_id']}")
    print(f"gray_balance_table_id={summary['gray_balance_table_id']}")
    print(f"default_lut_table_id={summary['default_lut_table_id']}")
    print(f"resolution_table_id={summary['resolution_table_id']}")
    filter_sequences = summary["filter_sequences"]
    filter_text = ",".join(
        f"{key}:{value}" for key, value in sorted(filter_sequences.items())
    )
    print(f"filter_sequences={filter_text}")
    input_text = ",".join(str(value) for value in summary["input_resolutions"])
    output_text = ",".join(str(value) for value in summary["output_resolutions"])
    print(f"input_resolutions={input_text}")
    print(f"output_resolutions={output_text}")
    for name, path in sorted(summary["sources"].items()):
        print(f"source_{name}={path}")


def print_resolved_service(service, index: int | None = None) -> None:
    prefix = f"service_{index}_" if index is not None else ""
    print(f"{prefix}name={service.instance_name}")
    print(f"{prefix}service_type={service.service_type}")
    print(f"{prefix}domain={service.domain}")
    print(f"{prefix}host={service.host}")
    print(f"{prefix}port={service.port}")
    if service.interface_index is not None:
        print(f"{prefix}interface_index={service.interface_index}")
    if service.fullname is not None:
        print(f"{prefix}fullname={service.fullname}")
    for key, value in sorted(service.txt.items()):
        print(f"{prefix}txt_{key}={value}")


def print_scan_plan(plan) -> None:
    summary = plan.summary()
    print(f"scan_dpi={summary['dpi']}")
    print(f"scan_buffer_size={summary['buffer_size']}")
    print(f"scan_source={summary['source_tag']}")
    print(f"scan_color_mode={summary['color_mode_tag']}")
    print(f"scan_format={summary['format_tag']}")
    print(f"scan_gamma_mode={summary['gamma_mode_tag']}")
    print(f"scan_tone_mode={summary['tone_mode_tag']}")
    acq = summary["acquisition"]
    print(
        "scan_acquisition="
        f"{acq['left']},{acq['top']},{acq['width']},{acq['lines']}"
    )
    print(f"scan_mechanical_actions={','.join(summary['mechanical_actions'])}")
    print(f"scan_filter_sequence_type={summary['filter_sequence_type']}")
    print(f"scan_filter_sequence_table_id={summary['filter_sequence_table_id']}")
    print(f"scan_profile_table_id={summary['profile_table_id']}")
    print(f"scan_gray_balance_table_id={summary['gray_balance_table_id']}")
    print(f"scan_default_lut_table_id={summary['default_lut_table_id']}")
    print(f"scan_resolution_table_id={summary['resolution_table_id']}")
    print(f"scan_default_scan_mode={summary['default_scan_mode']}")
    print(f"scan_document_mode={summary['document_mode']}")
    print(f"scan_auto_detect_long_paper={summary['auto_detect_long_paper']}")
    print(
        "scan_default_double_feed_detection="
        f"{summary['default_double_feed_detection']}"
    )
    print(f"scan_carrier_sheet_mode={summary['carrier_sheet_mode']}")


def print_event_manager_state(state: EventManagerNetworkSettings) -> None:
    print(f"event_manager_settings_path={state.settings_path}")
    print(f"event_manager_log_path={state.log_path}")
    print(f"event_manager_settings_exists={state.settings_exists}")
    if state.enabled is not None:
        print(f"event_manager_enabled={state.enabled}")
    if state.pc_name is not None:
        print(f"event_manager_pc_name={state.pc_name}")
    if state.log_message is not None:
        print(f"event_manager_log={state.log_message}")
    if state.error is not None:
        print(f"event_manager_error={state.error}")


def print_webconfig_status(status: WebConfigStatus) -> None:
    print(f"webconfig_url={status.url}")
    if status.status_code is not None:
        print(f"webconfig_status={status.status_code}")
    if status.title is not None:
        print(f"webconfig_title={status.title}")
    if status.header_text is not None:
        print(f"webconfig_header={status.header_text}")
    if status.form_action is not None:
        print(f"webconfig_form_action={status.form_action}")
    print(f"webconfig_force_password_required={status.force_password_required}")
    print(f"webconfig_admin_page_accessible={status.admin_page_accessible}")
    if status.redirect_path is not None:
        print(f"webconfig_redirect_path={status.redirect_path}")
    if status.error is not None:
        print(f"webconfig_error={status.error}")


if __name__ == "__main__":
    raise SystemExit(main())
