from __future__ import annotations

import unittest

from ff680w_re.errors import ProtocolError
from ff680w_re.session import EscI2Session


class _FakeTransport:
    def __init__(self, transact_results: list[bytes], recv_results: list[bytes] | None = None) -> None:
        self._transact_results = list(transact_results)
        self._recv_results = list(recv_results or [])

    def open(self) -> None:
        pass

    def close(self) -> None:
        pass

    def send(self, payload: bytes, *, expected_reply_length: int = 0) -> int:
        return len(payload)

    def recv(self, length: int) -> bytes:
        return self._recv_results.pop(0)

    def transact(self, payload: bytes, *, reply_length: int = 0) -> bytes:
        return self._transact_results.pop(0)


class SessionTests(unittest.TestCase):
    def test_unlock_accepts_ack_prefixed_packet(self) -> None:
        transport = _FakeTransport([b"\x06rest-of-packet"])
        session = EscI2Session(transport)
        session.unlock()

    def test_unlock_accepts_benign_unknown_frame(self) -> None:
        transport = _FakeTransport([b"UNKNx0000000#---"])
        session = EscI2Session(transport)
        session.unlock()

    def test_query_rejects_short_immediate_reply(self) -> None:
        transport = _FakeTransport([b"INFOx0000000"])
        session = EscI2Session(transport)

        with self.assertRaises(ProtocolError):
            session.info()


if __name__ == "__main__":
    unittest.main()
