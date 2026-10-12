from __future__ import annotations

import socket
import threading
import unittest
from unittest import mock

from ff680w_re.transports import network
from ff680w_re.transports.network import (
    NETWORK_SESSION_LOCK_PAYLOAD,
    NETWORK_SESSION_LOCK_OPCODE,
    NETWORK_SESSION_UNLOCK_OPCODE,
    build_epsontcpip_uri,
    build_network_probe_frame,
    discover_scanners,
    endpoint_from_bonjour_service,
    local_wifi_hints,
    parse_network_greeting,
    parse_network_reply,
    probe_network_greeting,
    probe_tcp_endpoint,
    probe_tls_endpoint,
    send_network_probe,
    start_network_session,
)


SAMPLE_BROWSE_OUTPUT = """\
Browsing for _scanner._tcp.local.
DATE: ---Fri 03 Apr 2026---
14:07:19.936  ...STARTING...
Timestamp     A/R    Flags  if Domain               Service Type         Instance Name
14:07:19.937  Add        2  14 local.               _scanner._tcp.       EPSON FF-680W
"""

SAMPLE_RESOLVE_OUTPUT = """\
Lookup EPSON FF-680W._scanner._tcp.local.
DATE: ---Fri 03 Apr 2026---
14:07:28.090  ...STARTING...
14:07:28.091  EPSON\\032FF-680W._scanner._tcp.local. can be reached at EPSONFB2F50.local.:1865 (interface 14)
 txtvers=1 ty=EPSON\\ FF-680W adminurl=http://EPSONFB2F50.local.:80/ mfg=EPSON mdl=FF-680W UUID=cfe92100-67c4-11d4-a45f-dccd2ffb2f50 scannerAvailable=0 note=
"""

SAMPLE_GREETING = bytes.fromhex(
    "49538000380c0000001800000104810001010110fe8000000000000008230bc82b1438fe"
)
SAMPLE_REPLY = bytes.fromhex("49538000380c0000000500000104000000")


class NetworkTests(unittest.TestCase):
    def test_local_wifi_hints_match_xiop_import(self) -> None:
        hints = local_wifi_hints("10.0.0.4")

        self.assertEqual(hints.bonjour_services, ("_scanner._tcp",))
        self.assertEqual(hints.alternate_bonjour_services, ("_uscan._tcp", "_ippusb._tcp"))
        self.assertIn("epsontcpip://10.0.0.4/1865", hints.example_uri)
        self.assertTrue(hints.source_path.endswith("/XIOP"))
        self.assertTrue(hints.event_manager_settings_path.endswith("NetWorkScanSetting.plist"))
        self.assertTrue(hints.event_manager_log_path.endswith("NetWorkLogInfo.plist"))

    def test_build_epsontcpip_uri_matches_local_xiop_shape(self) -> None:
        uri = build_epsontcpip_uri("scanner.local", port=1865)
        self.assertEqual(
            uri,
            'network epsontcpip://scanner.local/1865 "EPSON FF-680W" "FF-680W (IP)"',
        )

    def test_endpoint_from_bonjour_service_uses_txt_metadata(self) -> None:
        service = network._parse_dns_sd_resolve_output(
            SAMPLE_RESOLVE_OUTPUT,
            instance_name="EPSON FF-680W",
            service_type="_scanner._tcp",
            domain="local.",
        )

        assert service is not None
        endpoint = endpoint_from_bonjour_service(service)

        self.assertEqual(endpoint.host, "EPSONFB2F50.local")
        self.assertEqual(endpoint.port, 1865)
        self.assertEqual(endpoint.vendor_name, "EPSON")
        self.assertEqual(endpoint.model_name, "FF-680W")
        self.assertEqual(endpoint.service_name, "EPSON FF-680W")
        self.assertEqual(endpoint.service_type, "_scanner._tcp")
        self.assertEqual(endpoint.domain, "local.")
        self.assertEqual(endpoint.txt["UUID"], "cfe92100-67c4-11d4-a45f-dccd2ffb2f50")
        self.assertEqual(
            build_epsontcpip_uri(endpoint),
            'network epsontcpip://EPSONFB2F50.local/1865 "EPSON FF-680W" "EPSON FF-680W"',
        )

    def test_build_network_probe_frame_wraps_info_request(self) -> None:
        frame = build_network_probe_frame("INFO")
        self.assertEqual(frame[:2], b"IS")
        self.assertEqual(frame[2:4], b"\x20\x00")
        self.assertEqual(frame[12:16], (12).to_bytes(4, "big"))
        self.assertEqual(frame[16:20], (64).to_bytes(4, "big"))
        self.assertEqual(frame[20:], b"INFOx0000000")

    def test_parse_dns_sd_browse_output(self) -> None:
        services = network._parse_dns_sd_browse_output(SAMPLE_BROWSE_OUTPUT)

        self.assertEqual(len(services), 1)
        self.assertEqual(services[0].instance_name, "EPSON FF-680W")
        self.assertEqual(services[0].service_type, "_scanner._tcp")
        self.assertEqual(services[0].domain, "local.")
        self.assertEqual(services[0].interface_index, 14)
        self.assertEqual(services[0].flags, 2)
        self.assertEqual(services[0].action, "Add")

    def test_parse_dns_sd_resolve_output(self) -> None:
        service = network._parse_dns_sd_resolve_output(
            SAMPLE_RESOLVE_OUTPUT,
            instance_name="EPSON FF-680W",
            service_type="_scanner._tcp",
            domain="local.",
        )

        self.assertIsNotNone(service)
        assert service is not None
        self.assertEqual(service.host, "EPSONFB2F50.local")
        self.assertEqual(service.port, 1865)
        self.assertEqual(service.interface_index, 14)
        self.assertEqual(service.txt["mdl"], "FF-680W")
        self.assertEqual(service.txt["ty"], "EPSON FF-680W")
        self.assertEqual(service.txt["scannerAvailable"], "0")
        self.assertEqual(service.txt["note"], "")

    @mock.patch("ff680w_re.transports.network._run_dns_sd")
    def test_discover_scanners_browses_then_resolves(self, mock_run_dns_sd: mock.Mock) -> None:
        mock_run_dns_sd.side_effect = [SAMPLE_BROWSE_OUTPUT, SAMPLE_RESOLVE_OUTPUT]

        services = discover_scanners(service_types=("_scanner._tcp",), timeout=0.1)

        self.assertEqual(len(services), 1)
        self.assertEqual(services[0].instance_name, "EPSON FF-680W")
        self.assertEqual(services[0].host, "EPSONFB2F50.local")
        self.assertEqual(services[0].txt["mfg"], "EPSON")

    @mock.patch("ff680w_re.transports.network._run_dns_sd")
    def test_discover_scanners_falls_back_to_known_epson_name(self, mock_run_dns_sd: mock.Mock) -> None:
        mock_run_dns_sd.side_effect = [
            "Browsing for _scanner._tcp.local.\nDATE: ---Fri 03 Apr 2026---\n14:07:19.936  ...STARTING...\n",
            SAMPLE_RESOLVE_OUTPUT,
        ]

        services = discover_scanners(service_types=("_scanner._tcp",), timeout=0.1)

        self.assertEqual(len(services), 1)
        self.assertEqual(services[0].instance_name, "EPSON FF-680W")
        self.assertEqual(services[0].host, "EPSONFB2F50.local")

    def test_parse_network_reply_matches_live_wifi_probe_shape(self) -> None:
        reply = parse_network_reply(SAMPLE_GREETING)

        self.assertEqual(reply.opcode, 0x8000)
        self.assertEqual(reply.header_code, 0x380C)
        self.assertEqual(reply.payload_length, 24)
        self.assertEqual(reply.reserved, b"\x00\x00")
        self.assertEqual(
            reply.payload,
            bytes.fromhex("0104810001010110fe8000000000000008230bc82b1438fe"),
        )

    def test_parse_network_greeting_infers_ipv6_tail(self) -> None:
        greeting = parse_network_greeting(SAMPLE_GREETING)

        self.assertEqual(greeting.payload_prefix, bytes.fromhex("0104810001010110"))
        self.assertEqual(greeting.address_family_code, 1)
        self.assertEqual(greeting.address_length, 16)
        self.assertEqual(
            greeting.address_bytes,
            bytes.fromhex("fe8000000000000008230bc82b1438fe"),
        )
        self.assertEqual(greeting.inferred_ipv6_address, "fe80::823:bc8:2b14:38fe")
        self.assertIn("IPv6", greeting.note or "")

    def test_probe_tcp_endpoint_connects_to_local_socket(self) -> None:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        accepted = threading.Event()

        def serve() -> None:
            try:
                conn, _ = server.accept()
                accepted.set()
                conn.close()
            finally:
                server.close()

        thread = threading.Thread(target=serve)
        thread.start()
        try:
            result = probe_tcp_endpoint("127.0.0.1", port=port, timeout=1.0)
        finally:
            thread.join(timeout=1.0)

        self.assertTrue(accepted.is_set())
        self.assertTrue(result.reachable)
        self.assertEqual(result.resolved_ip, "127.0.0.1")
        self.assertIsNotNone(result.latency_ms)
        self.assertIsNone(result.error)

    def test_send_network_probe_round_trips_with_local_socket(self) -> None:
        request_bytes = build_network_probe_frame("INFO")
        received: list[bytes] = []

        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve() -> None:
            try:
                conn, _ = server.accept()
                with conn:
                    received.append(conn.recv(4096))
                    conn.sendall(SAMPLE_REPLY)
            finally:
                server.close()

        thread = threading.Thread(target=serve)
        thread.start()
        try:
            result = send_network_probe(
                "127.0.0.1",
                port=port,
                timeout=1.0,
                command="INFO",
            )
        finally:
            thread.join(timeout=1.0)

        self.assertEqual(received, [request_bytes])
        self.assertEqual(result.response, SAMPLE_REPLY)
        self.assertEqual(result.sent_bytes, len(request_bytes))
        self.assertEqual(result.resolved_ip, "127.0.0.1")
        self.assertIsNotNone(result.parsed_reply)
        assert result.parsed_reply is not None
        self.assertEqual(result.parsed_reply.payload, b"\x01\x04\x00\x00\x00")
        self.assertIsNone(result.error)

    def test_probe_tls_endpoint_reports_handshake_failure_on_plain_socket(self) -> None:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve() -> None:
            try:
                conn, _ = server.accept()
                with conn:
                    conn.sendall(SAMPLE_GREETING)
            finally:
                server.close()

        thread = threading.Thread(target=serve)
        thread.start()
        try:
            result = probe_tls_endpoint(
                "127.0.0.1",
                port=port,
                timeout=1.0,
            )
        finally:
            thread.join(timeout=1.0)

        self.assertTrue(result.tcp_connected)
        self.assertFalse(result.tls_established)
        self.assertEqual(result.resolved_ip, "127.0.0.1")
        self.assertIsNotNone(result.error)

    def test_probe_network_greeting_reads_frame_and_detects_close(self) -> None:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve() -> None:
            try:
                conn, _ = server.accept()
                with conn:
                    conn.sendall(SAMPLE_GREETING)
            finally:
                server.close()

        thread = threading.Thread(target=serve)
        thread.start()
        try:
            result = probe_network_greeting(
                "127.0.0.1",
                port=port,
                timeout=1.0,
                linger=0.05,
            )
        finally:
            thread.join(timeout=1.0)

        self.assertIsNotNone(result.greeting)
        assert result.greeting is not None
        self.assertEqual(result.greeting.name, "GREETING")
        self.assertEqual(result.greeting.response, SAMPLE_GREETING)
        self.assertIsNotNone(result.greeting.parsed_greeting)
        assert result.greeting.parsed_greeting is not None
        self.assertEqual(
            result.greeting.parsed_greeting.inferred_ipv6_address,
            "fe80::823:bc8:2b14:38fe",
        )
        self.assertTrue(result.closed_after_greeting)
        self.assertIsNone(result.error)

    def test_start_network_session_runs_lock_probe_unlock_sequence(self) -> None:
        info_request = build_network_probe_frame("INFO")
        stat_request = build_network_probe_frame("STAT")
        received: list[bytes] = []

        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve() -> None:
            try:
                conn, _ = server.accept()
                with conn:
                    conn.sendall(SAMPLE_GREETING)
                    for response in (SAMPLE_REPLY, SAMPLE_REPLY, SAMPLE_REPLY, b""):
                        payload = conn.recv(4096)
                        received.append(payload)
                        if response:
                            conn.sendall(response)
            finally:
                server.close()

        thread = threading.Thread(target=serve)
        thread.start()
        try:
            result = start_network_session(
                "127.0.0.1",
                port=port,
                timeout=1.0,
                control_timeout=0.1,
            )
        finally:
            thread.join(timeout=1.0)

        self.assertTrue(result.connected)
        self.assertIsNone(result.error)
        self.assertEqual(result.resolved_ip, "127.0.0.1")
        self.assertEqual(len(result.exchanges), 5)
        self.assertEqual(result.exchanges[0].name, "GREETING")
        self.assertEqual(result.exchanges[0].response, SAMPLE_GREETING)
        self.assertIsNotNone(result.exchanges[0].parsed_greeting)
        self.assertEqual(result.exchanges[1].name, "LOCK")
        self.assertEqual(result.exchanges[1].opcode, NETWORK_SESSION_LOCK_OPCODE)
        self.assertEqual(result.exchanges[1].response, SAMPLE_REPLY)
        self.assertEqual(result.exchanges[2].name, "INFO")
        self.assertEqual(result.exchanges[2].response, SAMPLE_REPLY)
        self.assertEqual(result.exchanges[3].name, "STAT")
        self.assertEqual(result.exchanges[3].response, SAMPLE_REPLY)
        self.assertEqual(result.exchanges[4].name, "UNLOCK")
        self.assertEqual(result.exchanges[4].opcode, NETWORK_SESSION_UNLOCK_OPCODE)
        self.assertEqual(received[1], info_request)
        self.assertEqual(received[2], stat_request)
        self.assertEqual(received[0], network.build_network_session_frame(0x2100, NETWORK_SESSION_LOCK_PAYLOAD))
        self.assertTrue(received[3].startswith(b"IS\x21\x01"))


if __name__ == "__main__":
    unittest.main()
