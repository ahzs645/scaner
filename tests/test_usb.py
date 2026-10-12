from __future__ import annotations

import types
import unittest
from unittest.mock import patch

from ff680w_re.transports import usb as usb_transport


class _FakeDevice:
    def __init__(self, serial: str | None) -> None:
        self.iSerialNumber = 1 if serial is not None else 0
        self._serial = serial


class UsbTransportTests(unittest.TestCase):
    def test_find_device_returns_first_match_without_serial_filter(self) -> None:
        fake_devices = [_FakeDevice("scanner-a"), _FakeDevice("scanner-b")]
        fake_usb = types.SimpleNamespace(
            core=types.SimpleNamespace(find=lambda **_: iter(fake_devices)),
            util=types.SimpleNamespace(get_string=lambda dev, _: dev._serial),
        )

        with patch.object(usb_transport, "usb", fake_usb):
            match = usb_transport._find_device(0x04B8, 0x016B, None)

        self.assertIs(match, fake_devices[0])

    def test_find_device_filters_by_serial_number(self) -> None:
        fake_devices = [_FakeDevice("scanner-a"), _FakeDevice("scanner-b")]
        fake_usb = types.SimpleNamespace(
            core=types.SimpleNamespace(find=lambda **_: iter(fake_devices)),
            util=types.SimpleNamespace(get_string=lambda dev, _: dev._serial),
        )

        with patch.object(usb_transport, "usb", fake_usb):
            match = usb_transport._find_device(0x04B8, 0x016B, "scanner-b")

        self.assertIs(match, fake_devices[1])

    def test_find_device_returns_none_for_unknown_serial_number(self) -> None:
        fake_devices = [_FakeDevice("scanner-a")]
        fake_usb = types.SimpleNamespace(
            core=types.SimpleNamespace(find=lambda **_: iter(fake_devices)),
            util=types.SimpleNamespace(get_string=lambda dev, _: dev._serial),
        )

        with patch.object(usb_transport, "usb", fake_usb):
            match = usb_transport._find_device(0x04B8, 0x016B, "missing")

        self.assertIsNone(match)

    def test_safe_get_string_handles_value_error(self) -> None:
        fake_device = _FakeDevice("scanner-a")
        fake_usb = types.SimpleNamespace(
            core=types.SimpleNamespace(USBError=RuntimeError),
            util=types.SimpleNamespace(get_string=lambda dev, _: (_ for _ in ()).throw(ValueError())),
        )

        with patch.object(usb_transport, "usb", fake_usb):
            value = usb_transport._safe_get_string(fake_device, fake_device.iSerialNumber)

        self.assertIsNone(value)

    def test_reset_usb_device_raises_when_device_is_missing(self) -> None:
        fake_usb = types.SimpleNamespace(
            core=types.SimpleNamespace(find=lambda **_: iter(()), USBError=RuntimeError),
            util=types.SimpleNamespace(get_string=lambda dev, _: dev._serial),
        )

        with patch.object(usb_transport, "usb", fake_usb):
            with self.assertRaises(usb_transport.DeviceNotFoundError):
                usb_transport.reset_usb_device()


if __name__ == "__main__":
    unittest.main()
