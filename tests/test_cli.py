from __future__ import annotations

import unittest

from ff680w_re.cli import build_parser


class CliParserTests(unittest.TestCase):
    def test_net_wrap_keeps_main_command(self) -> None:
        args = build_parser().parse_args(["net", "wrap", "--command", "INFO"])

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "wrap")
        self.assertEqual(args.esc_command, "INFO")

    def test_usb_trace_keeps_main_command(self) -> None:
        args = build_parser().parse_args(["usb", "trace", "--command", "STAT"])

        self.assertEqual(args.main_command, "usb")
        self.assertEqual(args.usb_command, "trace")
        self.assertEqual(args.esc_command, "STAT")

    def test_net_send_probe_keeps_command_and_host(self) -> None:
        args = build_parser().parse_args(
            ["net", "send-probe", "--host", "scanner.local", "--command", "INFO"]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "send-probe")
        self.assertEqual(args.host, "scanner.local")
        self.assertEqual(args.esc_command, "INFO")

    def test_net_resolve_keeps_name(self) -> None:
        args = build_parser().parse_args(
            ["net", "resolve", "--name", "EPSON FF-680W"]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "resolve")
        self.assertEqual(args.name, "EPSON FF-680W")

    def test_net_greeting_accepts_bonjour_name(self) -> None:
        args = build_parser().parse_args(
            ["net", "greeting", "--name", "EPSON FF-680W"]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "greeting")
        self.assertEqual(args.name, "EPSON FF-680W")
        self.assertIsNone(args.host)

    def test_net_endpoint_accepts_bonjour_name(self) -> None:
        args = build_parser().parse_args(
            ["net", "endpoint", "--name", "EPSON FF-680W"]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "endpoint")
        self.assertEqual(args.name, "EPSON FF-680W")
        self.assertIsNone(args.host)

    def test_net_startup_accepts_host_and_commands(self) -> None:
        args = build_parser().parse_args(
            [
                "net",
                "startup",
                "--host",
                "scanner.local",
                "--command",
                "INFO",
                "--command",
                "STAT",
            ]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "startup")
        self.assertEqual(args.host, "scanner.local")
        self.assertEqual(args.startup_commands, ["INFO", "STAT"])
        self.assertFalse(args.no_default_commands)

    def test_net_startup_can_disable_default_commands(self) -> None:
        args = build_parser().parse_args(
            [
                "net",
                "startup",
                "--host",
                "scanner.local",
                "--skip-lock",
                "--no-default-commands",
            ]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "startup")
        self.assertEqual(args.host, "scanner.local")
        self.assertTrue(args.skip_lock)
        self.assertTrue(args.no_default_commands)
        self.assertIsNone(args.startup_commands)

    def test_net_tls_probe_accepts_bonjour_name(self) -> None:
        args = build_parser().parse_args(
            ["net", "tls-probe", "--name", "EPSON FF-680W"]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "tls-probe")
        self.assertEqual(args.name, "EPSON FF-680W")
        self.assertIsNone(args.host)
        self.assertFalse(args.verify_peer)

    def test_net_webconfig_state_accepts_bonjour_name(self) -> None:
        args = build_parser().parse_args(
            ["net", "webconfig-state", "--name", "EPSON FF-680W"]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "webconfig-state")
        self.assertEqual(args.name, "EPSON FF-680W")
        self.assertIsNone(args.host)

    def test_net_pair_state_accepts_bonjour_name(self) -> None:
        args = build_parser().parse_args(
            ["net", "pair-state", "--name", "EPSON FF-680W"]
        )

        self.assertEqual(args.main_command, "net")
        self.assertEqual(args.net_command, "pair-state")
        self.assertEqual(args.name, "EPSON FF-680W")
        self.assertIsNone(args.host)


if __name__ == "__main__":
    unittest.main()
