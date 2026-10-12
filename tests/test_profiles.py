from __future__ import annotations

import unittest

from ff680w_re.profiles import (
    FF680W_MONO_LUT,
    GrayJpegScanPlan,
    SUPPORTED_INPUT_RESOLUTIONS,
    SUPPORTED_OUTPUT_RESOLUTIONS,
    build_ff680w_gray_jpeg_payload,
    default_ff680w_gray_jpeg_scan_plan,
    default_ff680w_jpeg_scan_plan,
    letter_scan_area_300dpi_centered,
)


class ProfileTests(unittest.TestCase):
    def test_normal_job_plan_does_not_infer_mechanical_load_from_document_mode(self) -> None:
        for mode in ("gray", "color"):
            self.assertEqual(default_ff680w_jpeg_scan_plan(mode=mode).mechanical_actions, ())
        # Keep the old diagnostic probe API intact.
        self.assertEqual(default_ff680w_gray_jpeg_scan_plan().mechanical_actions, ("#ADFLOAD",))

    def test_sheet_limits_count_image_sides_and_reset_unlimited_jobs(self) -> None:
        for duplex, sheets, count in (
            (False, 0, 0), (True, 0, 0),
            (False, 1, 1), (True, 1, 2), (True, 2, 4),
        ):
            with self.subTest(duplex=duplex, sheets=sheets):
                plan = default_ff680w_jpeg_scan_plan(duplex=duplex, max_sheets=sheets)
                self.assertEqual(plan.page_count, count)
                self.assertIn(f"#PAGd{count:03d}".encode(), plan.to_payload())

    def test_200dpi_letter_uses_centered_aligned_acquisition(self) -> None:
        plan = default_ff680w_jpeg_scan_plan(dpi=200)
        self.assertEqual(plan.acquisition, (2, 0, 1696, 2200))
        self.assertIn(b"#RSMd200#RSSd200", plan.to_payload())
        self.assertIn(b"#ACQi0000002i0000000i0001696i0002200", plan.to_payload())

    def test_host_interpolated_resolution_is_rejected_for_device_acquisition(self) -> None:
        for dpi in (1200, 4800, 9600):
            with self.subTest(dpi=dpi), self.assertRaisesRegex(ValueError, "device DPI"):
                default_ff680w_jpeg_scan_plan(dpi=dpi)

    def test_auto_crop_pairs_paper_end_detection_and_zero_margin(self) -> None:
        cropped = default_ff680w_jpeg_scan_plan(auto_crop=True, deskew=True)
        self.assertIn("CRP PEDT", cropped.source_tag)
        self.assertIn("SKEW", cropped.source_tag)
        self.assertIn(b"#CRPi0000000", cropped.to_payload())
        fixed = default_ff680w_jpeg_scan_plan(auto_crop=False)
        self.assertNotIn("CRP ", fixed.source_tag)
        self.assertNotIn(b"#CRP", fixed.to_payload())

    def test_crop_requires_advertised_cropping_resolution(self) -> None:
        for dpi in (300, 600):
            self.assertIn("PEDT", default_ff680w_jpeg_scan_plan(dpi=dpi, auto_crop=True).source_tag)
        for dpi in (50, 75, 100, 150, 200, 240, 360, 400):
            with self.subTest(dpi=dpi), self.assertRaisesRegex(ValueError, "cropping"):
                default_ff680w_jpeg_scan_plan(dpi=dpi, auto_crop=True)

    def test_quality_accepts_device_endpoints_and_rejects_outside_range(self) -> None:
        for quality in (1, 100):
            with self.subTest(quality=quality):
                self.assertIn(
                    f"#JPGd{quality:03d}".encode(),
                    default_ff680w_jpeg_scan_plan(quality=quality).to_payload(),
                )
        for quality in (0, 101):
            with self.subTest(quality=quality), self.assertRaisesRegex(ValueError, "quality"):
                default_ff680w_jpeg_scan_plan(quality=quality)

    def test_sheet_limit_bounds_prevent_three_digit_side_count_overflow(self) -> None:
        for duplex, sheets, count in ((False, 999, 999), (True, 499, 998)):
            with self.subTest(duplex=duplex, sheets=sheets):
                self.assertEqual(
                    default_ff680w_jpeg_scan_plan(duplex=duplex, max_sheets=sheets).page_count,
                    count,
                )
        for duplex, sheets in ((False, -1), (True, -1), (False, 1000), (True, 500)):
            with self.subTest(duplex=duplex, sheets=sheets), self.assertRaisesRegex(ValueError, "sheet count"):
                default_ff680w_jpeg_scan_plan(duplex=duplex, max_sheets=sheets)

    def test_letter_scan_area_matches_ff680w_centered_geometry(self) -> None:
        self.assertEqual(letter_scan_area_300dpi_centered(), (3, 0, 2544, 3300))

    def test_gray_payload_contains_exact_lut_and_acq(self) -> None:
        payload = build_ff680w_gray_jpeg_payload()
        self.assertIn(b"#ADF#COLM008#FMTJPG #JPGd090#GMMUG18", payload)
        self.assertIn(b"#RSMd300#RSSd300", payload)
        self.assertIn(b"#BSZi0065536", payload)
        self.assertIn(b"#ACQi0000003i0000000i0002544i0003300", payload)
        self.assertTrue(payload.endswith(FF680W_MONO_LUT))

    def test_supported_resolutions_come_from_vendored_epson_table(self) -> None:
        self.assertEqual(
            SUPPORTED_INPUT_RESOLUTIONS,
            (50, 75, 100, 150, 200, 240, 300, 360, 400, 9600),
        )
        self.assertEqual(
            SUPPORTED_OUTPUT_RESOLUTIONS,
            (50, 75, 100, 150, 200, 240, 300, 360, 400, 600),
        )

    def test_vendor_driven_gray_plan_uses_imported_table_ids_and_adf_load(self) -> None:
        plan = default_ff680w_gray_jpeg_scan_plan()

        self.assertIsInstance(plan, GrayJpegScanPlan)
        self.assertEqual(plan.mechanical_actions, ("#ADFLOAD",))
        self.assertEqual(plan.filter_sequence_table_id, "ESFilterSequence0101")
        self.assertEqual(plan.profile_table_id, "ESProfile0082")
        self.assertEqual(plan.gray_balance_table_id, "ESProfile1047")
        self.assertEqual(plan.default_lut_table_id, "ESLUT0016")
        self.assertEqual(plan.resolution_table_id, "ESResolution0162")
        self.assertEqual(plan.to_payload(), build_ff680w_gray_jpeg_payload())


if __name__ == "__main__":
    unittest.main()
