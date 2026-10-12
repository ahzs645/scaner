from __future__ import annotations

import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ff680w_re.transports.network import (
    EpsonTcpIpEndpoint,
    probe_network_pair_state,
    probe_webconfig_state,
    read_event_manager_network_settings,
)


COMMON_TOP_HTML = """\
<!DOCTYPE html>
<html>
<head><script>
location.href='/PRESENTATION/ADVANCED/FORCE_PASSWORD/TOP?accsessmethod=0';
</script></head>
</html>
"""

FORCE_PASSWORD_HTML = """\
<!DOCTYPE html>
<html>
<head><title>FF-680W</title></head>
<body>
<div class="header-main">Change Administrator Password</div>
<form action="SET" method="post"></form>
</body>
</html>
"""

COMMON_ADMIN_HTML = """\
<!DOCTYPE html>
<html>
<head><title>Epson Web Config</title></head>
<body>
<div class="header-main">Administrator Settings</div>
</body>
</html>
"""


class NetworkStateTests(unittest.TestCase):
    def test_read_event_manager_network_settings_reads_plists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            settings_path = temp_path / "NetWorkScanSetting.plist"
            log_path = temp_path / "NetWorkLogInfo.plist"
            with settings_path.open("wb") as handle:
                plistlib.dump(
                    {"EnableNetWorkScan": True, "PCName": "Mac.localdomain"},
                    handle,
                )
            with log_path.open("wb") as handle:
                plistlib.dump(
                    {"NetWorkLogInfo": "Service restart."},
                    handle,
                )

            state = read_event_manager_network_settings(
                settings_path=str(settings_path),
                log_path=str(log_path),
            )

        self.assertTrue(state.settings_exists)
        self.assertTrue(state.enabled)
        self.assertEqual(state.pc_name, "Mac.localdomain")
        self.assertEqual(state.log_message, "Service restart.")
        self.assertIsNone(state.error)

    def test_probe_webconfig_state_detects_forced_password_gate(self) -> None:
        seen_urls: list[str] = []

        def fetcher(url: str, timeout: float) -> tuple[int, str]:
            self.assertEqual(timeout, 1.5)
            seen_urls.append(url)
            if url.endswith("/PRESENTATION/ADVANCED/COMMON/TOP"):
                return 200, COMMON_TOP_HTML
            self.assertIn("/PRESENTATION/ADVANCED/FORCE_PASSWORD/TOP", url)
            return 200, FORCE_PASSWORD_HTML

        status = probe_webconfig_state(
            "EPSONFB2F50.local",
            timeout=1.5,
            fetcher=fetcher,
        )

        self.assertEqual(
            seen_urls,
            [
                "https://EPSONFB2F50.local/PRESENTATION/ADVANCED/COMMON/TOP",
                (
                    "https://EPSONFB2F50.local/"
                    "PRESENTATION/ADVANCED/FORCE_PASSWORD/TOP?accsessmethod=0"
                ),
            ],
        )
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.title, "FF-680W")
        self.assertEqual(status.header_text, "Change Administrator Password")
        self.assertEqual(status.form_action, "SET")
        self.assertTrue(status.force_password_required)
        self.assertFalse(status.admin_page_accessible)
        self.assertEqual(
            status.redirect_path,
            "/PRESENTATION/ADVANCED/FORCE_PASSWORD/TOP?accsessmethod=0",
        )
        self.assertIsNone(status.error)

    def test_probe_webconfig_state_accepts_admin_page_once_force_gate_is_cleared(self) -> None:
        seen_urls: list[str] = []

        def fetcher(url: str, timeout: float) -> tuple[int, str]:
            self.assertEqual(timeout, 1.5)
            seen_urls.append(url)
            return 200, COMMON_ADMIN_HTML

        status = probe_webconfig_state(
            "EPSONFB2F50.local",
            timeout=1.5,
            fetcher=fetcher,
        )

        self.assertEqual(
            seen_urls,
            ["https://EPSONFB2F50.local/PRESENTATION/ADVANCED/COMMON/TOP"],
        )
        self.assertEqual(status.url, seen_urls[0])
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.title, "Epson Web Config")
        self.assertEqual(status.header_text, "Administrator Settings")
        self.assertFalse(status.force_password_required)
        self.assertTrue(status.admin_page_accessible)
        self.assertIsNone(status.redirect_path)
        self.assertIsNone(status.error)

    @mock.patch("ff680w_re.transports._network_state.probe_scanner_snmp")
    @mock.patch("ff680w_re.transports._network_state.read_event_manager_network_settings")
    @mock.patch("ff680w_re.transports._network_state.probe_webconfig_state")
    @mock.patch("ff680w_re.transports._network_state._read_local_interface_addresses")
    def test_probe_network_pair_state_combines_sources(
        self,
        mock_local_interfaces: mock.Mock,
        mock_webconfig: mock.Mock,
        mock_event_manager: mock.Mock,
        mock_snmp: mock.Mock,
    ) -> None:
        endpoint = EpsonTcpIpEndpoint(
            host="EPSONFB2F50.local",
            port=1865,
            txt={"scannerAvailable": "0", "adminurl": "http://EPSONFB2F50.local.:80/"},
        )
        mock_event_manager.return_value = mock.Mock(enabled=True, pc_name="Mac.localdomain")
        mock_webconfig.return_value = mock.Mock(force_password_required=True)
        scalar = mock.Mock()
        scalar.name = "session_address"
        scalar.error = None
        scalar.value = "fe80::1"
        mock_snmp.return_value = mock.Mock(values=(scalar,))
        mock_local_interfaces.return_value = [("en0", "fe80::1")]

        state = probe_network_pair_state(
            endpoint,
            community="public",
            version="1",
            timeout=2.0,
        )

        self.assertEqual(state.endpoint, endpoint)
        self.assertEqual(state.bonjour_scanner_available, "0")
        self.assertEqual(state.bonjour_adminurl, "http://EPSONFB2F50.local.:80/")
        self.assertEqual(state.session_address, "fe80::1")
        self.assertTrue(state.session_address_matches_local_interface)
        self.assertEqual(state.session_address_interface, "en0")
        mock_event_manager.assert_called_once_with()
        mock_webconfig.assert_called_once_with(
            "EPSONFB2F50.local",
            timeout=2.0,
            fetcher=mock.ANY,
        )
        mock_snmp.assert_called_once_with(
            "EPSONFB2F50.local",
            community="public",
            version="1",
            timeout=2.0,
        )


if __name__ == "__main__":
    unittest.main()
