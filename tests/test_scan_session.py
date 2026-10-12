from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from ff680w_re.models import EscI2ImageBlock, EscI2Reply, EscI2Token
from ff680w_re.scan import run_gray_scan_probe
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


class ScanSessionTests(unittest.TestCase):
    def test_image_block_keeps_binary_data_out_of_token_parser(self) -> None:
        reply = b"IMG x0000004#pstd001d000\x00".ljust(64, b"\x00")
        transport = _FakeTransport([reply], [b"\xff\xd8\xff\xd9"])
        session = EscI2Session(transport)

        block = session.image_block()

        self.assertIsInstance(block, EscI2ImageBlock)
        self.assertEqual(block.extra_length, 4)
        self.assertEqual(block.data_block, b"\xff\xd8\xff\xd9")
        self.assertEqual([token.name for token in block.tokens], ["pst"])

    def test_scan_probe_uses_vendor_mechanical_action_before_para(self) -> None:
        class _FakeSession:
            def __init__(self) -> None:
                self.calls: list[tuple[str, object]] = []

            def mechanical(self, payload: str) -> EscI2Reply:
                self.calls.append(("MECH", payload))
                return EscI2Reply(command="MECH", header_block=b"MECHx0000000".ljust(64, b"\x00"))

            def set_parameters(self, payload: bytes) -> EscI2Reply:
                self.calls.append(("PARA", payload))
                return EscI2Reply(
                    command="PARA",
                    header_block=b"PARAx0000000".ljust(64, b"\x00"),
                    tokens=[EscI2Token(name="par", raw_value=b"OK  ")],
                )

            def transfer_data_ready(self) -> EscI2Reply:
                self.calls.append(("TRDT", None))
                return EscI2Reply(command="TRDT", header_block=b"TRDTx0000000".ljust(64, b"\x00"))

            def image_block(self) -> EscI2ImageBlock:
                self.calls.append(("IMG", None))
                return EscI2ImageBlock(
                    header_block=b"IMG x0000000".ljust(64, b"\x00"),
                    tokens=[EscI2Token(name="pen", raw_value=b"DONE")],
                )

        fake = _FakeSession()
        with tempfile.TemporaryDirectory() as tempdir:
            result = run_gray_scan_probe(fake, output_path=Path(tempdir) / "scan.jpg", polls=1)

        self.assertTrue(result.mechanical_ok)
        self.assertTrue(result.para_ok)
        self.assertTrue(result.trdt_ok)
        self.assertEqual(fake.calls[0], ("MECH", "#ADFLOAD"))
        self.assertEqual(fake.calls[1][0], "PARA")
        self.assertEqual(fake.calls[2], ("TRDT", None))


if __name__ == "__main__":
    unittest.main()
