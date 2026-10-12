from __future__ import annotations

import unittest
from unittest import mock

from ff680w_re.transports.network import (
    EPSON_SNMP_OIDS,
    format_snmp_value,
    parse_snmp_value,
    probe_scanner_snmp,
)


class NetworkSnmpTests(unittest.TestCase):
    def test_parse_snmp_string_value(self) -> None:
        value = parse_snmp_value(
            "pairing_host",
            ".1.2.3",
            stdout='SNMPv2-SMI::enterprises.1.2.3 = STRING: "Mac.localdomain"\n',
        )

        self.assertEqual(value.name, "pairing_host")
        self.assertEqual(value.value_type, "STRING")
        self.assertEqual(value.value, "Mac.localdomain")
        self.assertEqual(format_snmp_value(value.value), "Mac.localdomain")
        self.assertIsNone(value.error)

    def test_parse_snmp_integer_value(self) -> None:
        value = parse_snmp_value(
            "pairing_slot_state",
            ".1.2.3",
            stdout="SNMPv2-SMI::enterprises.1.2.3 = INTEGER: 2\n",
        )

        self.assertEqual(value.value_type, "INTEGER")
        self.assertEqual(value.value, 2)
        self.assertEqual(format_snmp_value(value.value), "2")

    def test_parse_snmp_hex_string_value(self) -> None:
        value = parse_snmp_value(
            "app_mib_30_2_5",
            ".1.2.3",
            stdout="SNMPv2-SMI::enterprises.1.2.3 = Hex-STRING: 80 E0 \n",
        )

        self.assertEqual(value.value_type, "Hex-STRING")
        self.assertEqual(value.value, bytes.fromhex("80e0"))
        self.assertEqual(format_snmp_value(value.value), "80e0")

    def test_parse_snmp_error_without_stdout(self) -> None:
        value = parse_snmp_value(
            "missing",
            ".1.2.3",
            stdout="",
            stderr="Error in packet",
            returncode=2,
        )

        self.assertIsNone(value.value)
        self.assertEqual(value.error, "Error in packet")

    @mock.patch("ff680w_re.transports._network_snmp.snmpget_path", return_value="/usr/bin/snmpget")
    def test_probe_scanner_snmp_queries_expected_oids(self, _mock_tool_path: mock.Mock) -> None:
        responses = {
            ".1.3.6.1.2.1.1.5.0": (0, 'SNMPv2-MIB::sysName.0 = STRING: "EPSONFB2F50"\n', ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.3.8.0": (0, 'SNMPv2-SMI::enterprises.1248.1.1.3.1.3.8.0 = STRING: "FF-680W"\n', ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.14.4.1.2.1": (0, 'SNMPv2-SMI::enterprises.1248.1.1.3.1.14.4.1.2.1 = STRING: "EPSON FF-680W"\n', ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.14.7.0": (0, 'SNMPv2-SMI::enterprises.1248.1.1.3.1.14.7.0 = STRING: "EPSONFB2F50"\n', ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.21.1.1.2.5": (0, 'SNMPv2-SMI::enterprises.1248.1.1.3.1.21.1.1.2.5 = STRING: "18.61.SP18P4"\n', ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.10.1.0": (0, "SNMPv2-SMI::enterprises.1248.1.1.3.1.10.1.0 = INTEGER: 1\n", ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.10.2.5.0": (0, 'SNMPv2-SMI::enterprises.1248.1.1.3.1.10.2.5.0 = STRING: "Mac.localdomain"\n', ""),
            ".1.3.6.1.4.1.1248.1.4.2.21.1.1.1.1": (0, "SNMPv2-SMI::enterprises.1248.1.4.2.21.1.1.1.1 = INTEGER: 2\n", ""),
            ".1.3.6.1.4.1.1248.1.4.2.21.1.1.2.1": (0, 'SNMPv2-SMI::enterprises.1248.1.4.2.21.1.1.2.1 = STRING: "fe80::823:bc8:2b14:38fe"\n', ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.30.1.1.0": (0, "SNMPv2-SMI::enterprises.1248.1.1.3.1.30.1.1.0 = INTEGER: 2\n", ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.30.1.3.0": (0, "SNMPv2-SMI::enterprises.1248.1.1.3.1.30.1.3.0 = INTEGER: 2\n", ""),
            ".1.3.6.1.4.1.1248.1.1.3.1.30.2.5.0": (0, "SNMPv2-SMI::enterprises.1248.1.1.3.1.30.2.5.0 = Hex-STRING: 80 E0 \n", ""),
        }
        seen_oids: list[str] = []

        def runner(args, timeout: float) -> tuple[int, str, str]:
            self.assertEqual(timeout, 1.5)
            oid = args[-1]
            seen_oids.append(oid)
            return responses[oid]

        snapshot = probe_scanner_snmp(
            "127.0.0.1",
            timeout=1.5,
            runner=runner,
        )

        self.assertEqual(seen_oids, [oid for _, oid in EPSON_SNMP_OIDS])
        self.assertEqual(snapshot.tool_path, "/usr/bin/snmpget")
        self.assertEqual(snapshot.resolved_ip, "127.0.0.1")
        values = {item.name: item for item in snapshot.values}
        self.assertEqual(values["pairing_host"].value, "Mac.localdomain")
        self.assertEqual(values["session_address"].value, "fe80::823:bc8:2b14:38fe")
        self.assertEqual(values["app_mib_30_2_5"].value, bytes.fromhex("80e0"))
