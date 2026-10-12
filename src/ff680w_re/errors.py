"""Project-specific exception types."""


class FF680WError(Exception):
    """Base exception for this project."""


class TransportUnavailableError(FF680WError):
    """Raised when a transport backend cannot be used."""


class DeviceNotFoundError(FF680WError):
    """Raised when the FF-680W cannot be found on the selected transport."""


class ProtocolError(FF680WError):
    """Raised when a reply does not match the expected protocol shape."""


class DeviceBusyError(ProtocolError):
    """Raised when the scanner reports BUSY."""


class DeviceNakError(ProtocolError):
    """Raised when the scanner returns a NAK to a control command."""

