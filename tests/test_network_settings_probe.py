from __future__ import annotations

import unittest

from ff680w_re.network_settings_probe import MAX_SETTINGS_BYTES, probe_network_settings


def outer(payload: bytes, *, declared: int | None = None) -> bytes:
    return b"IS\x80\x00\x38\x0c" + (len(payload) if declared is None else declared).to_bytes(4, "big") + b"\0\0" + payload


def immediate(command: str, extra: bytes = b"", tags: bytes = b"#---") -> bytes:
    return (f"{command}x{len(extra):07x}".encode() + tags).ljust(64, b"\0")


class SocketStub:
    def __init__(self, inbound: bytes, *, fragment: int = 1):
        self.inbound = bytearray(inbound)
        self.fragment = fragment
        self.writes: list[bytes] = []
        self.timeouts: list[float] = []
        self.closed = False

    def settimeout(self, value: float) -> None:
        self.timeouts.append(value)

    def sendall(self, packet: bytes) -> None:
        self.writes.append(packet)

    def recv(self, count: int) -> bytes:
        size = min(count, self.fragment, len(self.inbound))
        data = bytes(self.inbound[:size])
        del self.inbound[:size]
        return data

    def close(self) -> None:
        self.closed = True


class NetworkSettingsProbeTests(unittest.TestCase):
    def invoke(self, sock: SocketStub):
        return probe_network_settings("192.0.2.1", connector=lambda endpoint, timeout: sock)

    def test_exact_sane_sequence_with_fragmented_and_coalesced_tcp(self):
        info = b"#PRDh00aFF-680W   #---"
        capa = b"#ADFDPLX#COLLISTC024M008#---"
        inbound = outer(bytes.fromhex("0104000000")) + outer(b"\x06") + outer(b"\x06")
        inbound += outer(immediate("INFO", info)) + outer(info)
        inbound += outer(immediate("CAPA", capa)) + outer(capa)
        inbound += outer(immediate("RESA")) + outer(immediate("STAT", tags=b"#ERRADF PE  #---"))
        inbound += outer(immediate("FIN "))
        for fragment in (1, 7, 8192):
            sock = SocketStub(inbound, fragment=fragment)
            result = self.invoke(sock)
            self.assertTrue(result.success, result)
            self.assertEqual(list(result.settings), ["INFO", "CAPA", "RESA", "STAT"])
            self.assertEqual(result.settings["CAPA"]["data_bytes"], len(capa))
            self.assertEqual(sock.writes[0].hex(), "49532100000c00000007000001a0040000012c")
            self.assertEqual(sock.writes[1].hex(), "49532000000c0000000a000000000002000000011c58")
            self.assertEqual(sock.writes[2].hex(), "49532000000c0000001400000000000c00000040494e464f7830303030303030")
            self.assertEqual(sock.writes[3][12:20], bytes.fromhex("00000000") + len(info).to_bytes(4, "big"))
            self.assertEqual(sock.writes[-1].hex(), "49532101000c000000000000")
            self.assertEqual(sock.writes[-2][20:], b"FIN x0000000")
            self.assertFalse(any(command in packet for packet in sock.writes for command in (b"MECH", b"PARA", b"TRDT", b"IMG ", b"\x1cY")))
            self.assertTrue(sock.closed)
            self.assertFalse(sock.inbound)
            self.assertTrue(all(0 < value <= 3 for value in sock.timeouts))

    def test_busy_or_unknown_greeting_does_not_lock_or_take_over(self):
        for greeting in (bytes.fromhex("0104810001010110") + b"\0" * 16, b"different"):
            sock = SocketStub(outer(greeting))
            result = self.invoke(sock)
            self.assertFalse(result.success)
            self.assertIn("no session commands", result.error)
            self.assertEqual(sock.writes, [])
            self.assertTrue(sock.closed)

    def test_rejected_outer_lock_does_not_issue_tunneled_commands(self):
        sock = SocketStub(outer(bytes.fromhex("0104000000")) + outer(b"\x15"))
        result = self.invoke(sock)
        self.assertFalse(result.success)
        self.assertEqual(len(sock.writes), 1)
        self.assertIn("LOCK did not acknowledge", result.error)

    def test_rejected_fsx_releases_outer_lock_without_fin(self):
        sock = SocketStub(outer(bytes.fromhex("0104000000")) + outer(b"\x06") + outer(b"\x15"))
        result = self.invoke(sock)
        self.assertFalse(result.success)
        self.assertIn("FSX", result.error)
        self.assertEqual(sock.writes[-1].hex(), "49532101000c000000000000")
        self.assertFalse(any(b"FIN " in packet for packet in sock.writes))

    def test_oversized_or_incomplete_frame_never_allocates_advertised_settings(self):
        prefix = outer(bytes.fromhex("0104000000")) + outer(b"\x06") + outer(b"\x06")
        for bad in (outer(b"", declared=MAX_SETTINGS_BYTES + 1), outer(b"short", declared=64)):
            sock = SocketStub(prefix + bad)
            result = self.invoke(sock)
            self.assertFalse(result.success)
            self.assertFalse(any(" DATA" == entry.get("step") for entry in result.frames))
            self.assertTrue(sock.closed)
            self.assertEqual(sock.writes[-1].hex(), "49532101000c000000000000")

    def test_invalid_endpoint_or_budget_fails_before_connector(self):
        def forbidden(*args, **kwargs):
            self.fail("connector must not run")
        for kwargs in ({"host": "scanner.local"}, {"host": "192.0.2.1", "port": 0},
                       {"host": "192.0.2.1", "timeout": 0}, {"host": "192.0.2.1", "deadline_seconds": float("inf")}):
            with self.assertRaises(ValueError):
                probe_network_settings(**kwargs, connector=forbidden)


if __name__ == "__main__":
    unittest.main()
