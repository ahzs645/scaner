from __future__ import annotations

import unittest

from ff680w_re.vendor_data import (
    NETWORK_HINTS,
    default_adf_mechanical_actions,
    default_filter_sequence_type,
    filter_sequence_table_map,
    supported_input_resolutions,
    supported_output_resolutions,
    table_id,
    vendor_summary,
)


class VendorDataTests(unittest.TestCase):
    def test_vendor_summary_matches_ff680w_model_identity(self) -> None:
        summary = vendor_summary()

        self.assertEqual(summary["model_name"], "EPSON FF-680W")
        self.assertEqual(summary["model_id"], "0170")
        self.assertEqual(summary["product_id"], "016B")
        self.assertEqual(summary["default_lut_table_id"], "ESLUT0016")
        self.assertEqual(summary["profile_table_id"], "ESProfile0082")
        self.assertEqual(summary["gray_balance_table_id"], "ESProfile1047")
        self.assertEqual(summary["resolution_table_id"], "ESResolution0162")

    def test_vendored_resolution_tables_include_live_probe_dpi(self) -> None:
        self.assertIn(300, supported_input_resolutions())
        self.assertIn(300, supported_output_resolutions())
        self.assertEqual(max(supported_output_resolutions()), 600)

    def test_filter_sequence_map_matches_convert_table_conditions(self) -> None:
        self.assertEqual(
            filter_sequence_table_map(),
            {
                0: "ESFilterSequence0101",
                1: "ESFilterSequence0002",
                2: "ESFilterSequence0004",
                4: "ESFilterSequence0000",
            },
        )
        self.assertEqual(default_filter_sequence_type(), 0)
        self.assertEqual(default_adf_mechanical_actions(), ("#ADFLOAD",))

    def test_network_hints_capture_xiop_discovery_strings(self) -> None:
        self.assertIn("_scanner._tcp", NETWORK_HINTS["bonjour_services"])
        self.assertIn("epsontcpip://%s/%d", NETWORK_HINTS["uri_formats"][0])
        self.assertEqual(table_id("Resolution"), "ESResolution0162")


if __name__ == "__main__":
    unittest.main()
