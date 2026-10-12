from __future__ import annotations

import unittest

from ff680w_re.protocol import (
    EscI2Command,
    build_header,
    build_network_passthrough_frame,
    parse_extra_length,
    parse_tokens,
)


class ProtocolTests(unittest.TestCase):
    def test_build_header(self) -> None:
        self.assertEqual(build_header(EscI2Command.INFO), b"INFOx0000000")
        self.assertEqual(build_header(EscI2Command.PARA, 0x2A), b"PARAx000002a")

    def test_parse_extra_length(self) -> None:
        self.assertEqual(parse_extra_length(EscI2Command.INFO, b"INFOx0000010"), 0x10)

    def test_parse_tokens(self) -> None:
        block = b"#foohello#barx0000010#---"
        tokens = parse_tokens(block)
        self.assertEqual([token.name for token in tokens], ["foo", "bar"])
        self.assertEqual(tokens[0].text, "hello")
        self.assertEqual(tokens[1].text, "x0000010")

    def test_build_network_passthrough_frame(self) -> None:
        frame = build_network_passthrough_frame(0x2000, b"INFOx0000000", reply_length=64)
        self.assertEqual(frame[:2], b"IS")
        self.assertEqual(frame[2:4], b"\x20\x00")
        self.assertEqual(frame[10:12], b"\x00\x00")
        self.assertEqual(frame[12:16], len(b"INFOx0000000").to_bytes(4, "big"))
        self.assertEqual(frame[16:20], (64).to_bytes(4, "big"))

    def test_gamma_tables_preserve_delimiters_and_nuls(self) -> None:
        lut = bytes(range(256))
        tokens = parse_tokens(b"#GMTRED h100" + lut + b"#GMTGRN h100" + lut + b"#RSMd300#---")
        self.assertEqual([t.name for t in tokens], ["GMT", "GMT", "RSM"])
        self.assertEqual(tokens[0].raw_value, b"RED h100" + lut)
        self.assertEqual(tokens[2].text, "d300")

    def test_truncated_gamma_table_is_rejected(self) -> None:
        from ff680w_re.errors import ProtocolError
        with self.assertRaisesRegex(ProtocolError, "truncated GMT"):
            parse_tokens(b"#GMTRED h100" + b"\x00" * 8)


if __name__ == "__main__":
    unittest.main()
