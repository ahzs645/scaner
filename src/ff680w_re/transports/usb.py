"""USB transport scaffold for FF-680W ESC/I-2 work."""

from __future__ import annotations

from dataclasses import dataclass

from ..constants import FF680W_PRODUCT_ID, FF680W_VENDOR_ID, USB_TIMEOUT_MS
from ..errors import DeviceNotFoundError, ProtocolError, TransportUnavailableError
from ..models import UsbCandidate
from .base import Transport

try:
    import usb.core
    import usb.util
except ImportError:  # pragma: no cover - environment dependent
    usb = None


def discover_usb_candidates() -> list[UsbCandidate]:
    _require_pyusb()

    candidates: list[UsbCandidate] = []
    for dev in usb.core.find(find_all=True):
        candidates.append(
            UsbCandidate(
                vendor_id=int(dev.idVendor),
                product_id=int(dev.idProduct),
                manufacturer=_safe_get_string(dev, dev.iManufacturer),
                product=_safe_get_string(dev, dev.iProduct),
                serial_number=_safe_get_string(dev, dev.iSerialNumber),
                bus=getattr(dev, "bus", None),
                address=getattr(dev, "address", None),
            )
        )
    return candidates


def _find_device(vendor_id: int, product_id: int, serial_number: str | None) -> object | None:
    """Find a device by VID/PID and optional serial number.

    PyUSB's `find()` helper only understands descriptor fields. Serial number is
    a string descriptor, so filtering it manually keeps discovery and open()
    behavior aligned.
    """

    _require_pyusb()

    matches = usb.core.find(find_all=True, idVendor=vendor_id, idProduct=product_id)
    for dev in matches:
        if serial_number is None:
            return dev
        if _safe_get_string(dev, dev.iSerialNumber) == serial_number:
            return dev
    return None


def reset_usb_device(
    vendor_id: int = FF680W_VENDOR_ID,
    product_id: int = FF680W_PRODUCT_ID,
    serial_number: str | None = None,
) -> None:
    dev = _find_device(vendor_id=vendor_id, product_id=product_id, serial_number=serial_number)
    if dev is None:
        raise DeviceNotFoundError(
            f"USB device 0x{vendor_id:04x}:0x{product_id:04x} not found"
        )
    try:
        dev.reset()
    except usb.core.USBError as exc:
        raise ProtocolError(f"USB reset failed: {exc}") from exc


@dataclass(slots=True)
class UsbTransport(Transport):
    vendor_id: int = FF680W_VENDOR_ID
    product_id: int = FF680W_PRODUCT_ID
    serial_number: str | None = None
    timeout_ms: int = USB_TIMEOUT_MS

    _device: object | None = None
    _ep_in: object | None = None
    _ep_out: object | None = None
    _interface_number: int | None = None

    def open(self) -> None:
        _require_pyusb()

        dev = _find_device(
            vendor_id=self.vendor_id,
            product_id=self.product_id,
            serial_number=self.serial_number,
        )
        if dev is None:
            raise DeviceNotFoundError(
                f"USB device 0x{self.vendor_id:04x}:0x{self.product_id:04x} not found"
            )

        self._device = dev

        try:
            cfg = dev.get_active_configuration()
        except usb.core.USBError:
            dev.set_configuration()
            cfg = dev.get_active_configuration()

        intf = cfg[(0, 0)]
        self._interface_number = intf.bInterfaceNumber

        try:
            if dev.is_kernel_driver_active(self._interface_number):
                dev.detach_kernel_driver(self._interface_number)
        except (NotImplementedError, usb.core.USBError, AttributeError):
            pass

        self._ep_out = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: (
                usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_OUT
                and usb.util.endpoint_type(e.bmAttributes) == usb.util.ENDPOINT_TYPE_BULK
            ),
        )
        self._ep_in = usb.util.find_descriptor(
            intf,
            custom_match=lambda e: (
                usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN
                and usb.util.endpoint_type(e.bmAttributes) == usb.util.ENDPOINT_TYPE_BULK
            ),
        )

        if self._ep_in is None or self._ep_out is None:
            raise TransportUnavailableError("could not locate bulk USB endpoints")

    def close(self) -> None:
        if self._device is None:
            return

        try:
            usb.util.dispose_resources(self._device)
        finally:
            self._device = None
            self._ep_in = None
            self._ep_out = None
            self._interface_number = None

    def send(self, payload: bytes, *, expected_reply_length: int = 0) -> int:
        if self._ep_out is None:
            raise TransportUnavailableError("USB transport is not open")
        try:
            written = int(self._ep_out.write(payload, timeout=self.timeout_ms))
        except usb.core.USBError as exc:
            if getattr(exc, "errno", None) == 13:
                raise ProtocolError(
                    "USB access denied. Close Epson Scanner Monitor, ScanSmart, "
                    "FastFoto, and Image Capture before using the custom USB driver. "
                    f"Original error: {exc}"
                ) from exc
            raise ProtocolError(f"USB write failed: {exc}") from exc
        if written != len(payload):
            raise ProtocolError(f"short USB write: expected {len(payload)}, wrote {written}")
        return written

    def recv(self, length: int) -> bytes:
        if self._ep_in is None:
            raise TransportUnavailableError("USB transport is not open")
        try:
            raw = self._ep_in.read(length, timeout=self.timeout_ms)
        except usb.core.USBError as exc:
            raise ProtocolError(f"USB read failed: {exc}") from exc
        return bytes(raw)


def _require_pyusb() -> None:
    if usb is None:
        raise TransportUnavailableError(
            "pyusb is not installed; run `pip install -e .` and ensure libusb is available"
        )


def _safe_get_string(dev: object, index: int | None) -> str | None:
    if usb is None or not index:
        return None
    try:
        return usb.util.get_string(dev, index)
    except (usb.core.USBError, ValueError):
        return None
