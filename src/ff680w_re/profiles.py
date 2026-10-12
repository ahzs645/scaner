"""Model-specific payload helpers for live FF-680W USB work."""

from __future__ import annotations

from dataclasses import dataclass, replace

from .vendor_data import (
    ES0170_HARDWARE_INFO,
    default_adf_mechanical_actions,
    default_filter_sequence_type,
    filter_sequence_table_map,
    supported_input_resolutions,
    supported_output_resolutions,
    table_id,
)

FF680W_MONO_LUT = bytes(
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
        0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x0A, 0x0C,
        0x0E, 0x10, 0x12, 0x14, 0x16, 0x16, 0x19, 0x1B,
        0x1D, 0x1F, 0x21, 0x23, 0x25, 0x27, 0x28, 0x2A,
        0x2C, 0x2E, 0x30, 0x32, 0x33, 0x35, 0x37, 0x39,
        0x3A, 0x3C, 0x3E, 0x40, 0x41, 0x43, 0x45, 0x46,
        0x48, 0x4A, 0x4B, 0x4D, 0x4F, 0x50, 0x52, 0x53,
        0x55, 0x57, 0x58, 0x5A, 0x5B, 0x5D, 0x5F, 0x60,
        0x62, 0x63, 0x65, 0x66, 0x68, 0x69, 0x6B, 0x6C,
        0x6E, 0x6F, 0x71, 0x72, 0x74, 0x75, 0x77, 0x78,
        0x7A, 0x7B, 0x7D, 0x7E, 0x80, 0x81, 0x83, 0x84,
        0x86, 0x87, 0x88, 0x8A, 0x8B, 0x8D, 0x8E, 0x90,
        0x91, 0x92, 0x94, 0x95, 0x97, 0x98, 0x99, 0x9B,
        0x9C, 0x9E, 0x9F, 0xA0, 0xA2, 0xA3, 0xA5, 0xA7,
        0xA9, 0xAA, 0xAB, 0xAD, 0xAE, 0xB0, 0xB1, 0xB2,
        0xB4, 0xB5, 0xB6, 0xB8, 0xB9, 0xBA, 0xBC, 0xBD,
        0xBE, 0xC0, 0xC1, 0xC2, 0xC4, 0xC5, 0xC6, 0xC8,
        0xC9, 0xCA, 0xCC, 0xCD, 0xCE, 0xD0, 0xD1, 0xD2,
        0xD4, 0xD5, 0xD6, 0xD7, 0xD9, 0xDA, 0xDB, 0xDD,
        0xDE, 0xDF, 0xE1, 0xE2, 0xE3, 0xE4, 0xE6, 0xE7,
        0xE8, 0xE9, 0xEB, 0xEC, 0xED, 0xEF, 0xF0, 0xF1,
        0xF2, 0xF4, 0xF5, 0xF6, 0xF7, 0xF9, 0xFA, 0xFB,
        0xFC, 0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    ]
)

SUPPORTED_INPUT_RESOLUTIONS = supported_input_resolutions()
SUPPORTED_OUTPUT_RESOLUTIONS = supported_output_resolutions()
# The live CAPA list, rather than the model's host-output conversion table.
DEVICE_INPUT_RESOLUTIONS = (50, 75, 100, 150, 200, 240, 300, 360, 400, 600)
PAPER_SIZES = {"letter": (8.5, 11), "a4": (210 / 25.4, 297 / 25.4), "legal": (8.5, 14)}


@dataclass(slots=True)
class JpegScanPlan:
    dpi: int
    buffer_size: int
    acquisition: tuple[int, int, int, int]
    source_tag: str
    color_mode_tag: str
    format_tag: str
    gamma_mode_tag: str
    tone_mode_tag: str
    mechanical_actions: tuple[str, ...]
    filter_sequence_type: int
    filter_sequence_table_id: str
    profile_table_id: str
    gray_balance_table_id: str
    default_lut_table_id: str
    resolution_table_id: str
    default_scan_mode: int
    document_mode: int
    auto_detect_long_paper: bool
    default_double_feed_detection: bool
    carrier_sheet_mode: int
    lut: bytes = FF680W_MONO_LUT
    tone_payload: bytes | None = None
    page_count: int | None = None
    crop_margin: int | None = None

    def to_payload(self) -> bytes:
        left, top, width, lines = self.acquisition
        parts = [
            self.source_tag.encode("ascii"),
            self.color_mode_tag.encode("ascii"),
            self.format_tag.encode("ascii"),
            self.gamma_mode_tag.encode("ascii"),
            f"#RSMd{self.dpi:03d}#RSSd{self.dpi:03d}".encode("ascii"),
            f"#BSZi{self.buffer_size:07d}".encode("ascii"),
            f"#ACQi{left:07d}i{top:07d}i{width:07d}i{lines:07d}".encode("ascii"),
            f"#PAGd{self.page_count:03d}".encode("ascii") if self.page_count is not None else b"",
            f"#CRPi{self.crop_margin:07d}".encode("ascii") if self.crop_margin is not None else b"",
            self.tone_payload if self.tone_payload is not None
            else self.tone_mode_tag.encode("ascii") + self.lut,
        ]
        return b"".join(parts)

    def summary(self) -> dict[str, object]:
        left, top, width, lines = self.acquisition
        return {
            "dpi": self.dpi,
            "buffer_size": self.buffer_size,
            "image_count_limit": self.page_count,
            "crop_margin": self.crop_margin,
            "source_tag": self.source_tag,
            "color_mode_tag": self.color_mode_tag,
            "format_tag": self.format_tag,
            "gamma_mode_tag": self.gamma_mode_tag,
            "tone_mode_tag": self.tone_mode_tag,
            "acquisition": {
                "left": left,
                "top": top,
                "width": width,
                "lines": lines,
            },
            "mechanical_actions": self.mechanical_actions,
            "filter_sequence_type": self.filter_sequence_type,
            "filter_sequence_table_id": self.filter_sequence_table_id,
            "profile_table_id": self.profile_table_id,
            "gray_balance_table_id": self.gray_balance_table_id,
            "default_lut_table_id": self.default_lut_table_id,
            "resolution_table_id": self.resolution_table_id,
            "default_scan_mode": self.default_scan_mode,
            "document_mode": self.document_mode,
            "auto_detect_long_paper": self.auto_detect_long_paper,
            "default_double_feed_detection": self.default_double_feed_detection,
            "carrier_sheet_mode": self.carrier_sheet_mode,
        }


# Preserve the existing grayscale API.
GrayJpegScanPlan = JpegScanPlan


def default_ff680w_jpeg_scan_plan(
    *, mode: str = "color", duplex: bool = False, dpi: int = 300,
    max_sheets: int = 0, paper: str = "letter", quality: int = 90,
    deskew: bool = False, auto_crop: bool = False, double_feed: bool = True,
) -> JpegScanPlan:
    if mode not in {"color", "gray"}:
        raise ValueError(f"unsupported scan mode: {mode}")
    if dpi not in DEVICE_INPUT_RESOLUTIONS:
        raise ValueError(f"unsupported device DPI: {dpi}")
    if auto_crop and dpi not in (300, 600):
        raise ValueError("FF-680W advertises automatic cropping at 300 or 600 dpi")
    if paper not in PAPER_SIZES:
        raise ValueError(f"unsupported paper size: {paper}")
    page_count = max_sheets * (2 if duplex else 1)
    if max_sheets < 0 or page_count > 999:
        raise ValueError("sheet count must fit the scanner's three-digit image count (0 means all)")
    if not 1 <= quality <= 100:
        raise ValueError("JPEG quality must be between 1 and 100")
    plan = default_ff680w_gray_jpeg_scan_plan()
    physical_width = int(8.5 * dpi)
    width_inches, height_inches = PAPER_SIZES[paper]
    width = int(width_inches * dpi) & ~7
    source = "#ADF" + ("DPLX" if duplex else "")
    source += "DFL1" if double_feed else ""
    source += "SKEW" if deskew else ""
    # FF-680W cropping requires paper-end detection as well as CRP.
    source += "CRP PEDT" if auto_crop else ""
    plan = replace(
        plan, dpi=dpi, source_tag=source, page_count=page_count, mechanical_actions=(),
        acquisition=((physical_width - width) // 2, 0, width, int(height_inches * dpi)),
        format_tag=f"#FMTJPG #JPGd{quality:03d}",
        crop_margin=0 if auto_crop else None,
    )
    if mode == "color":
        # Use the identity channel LUTs returned by the scanner's RESA defaults.
        tone_payload = b"".join(
            b"#GMT" + channel + b"h100" + bytes(range(256))
            for channel in (b"RED ", b"GRN ", b"BLU ")
        )
        plan = replace(
            plan, color_mode_tag="#COLC024", tone_mode_tag="#GMTRED h100",
            tone_payload=tone_payload,
        )
    return plan


def letter_scan_area_300dpi_centered() -> tuple[int, int, int, int]:
    """Return the geometry SANE derives for FF-680W letter-width ADF scans."""

    physical_width = int(8.5 * 300)
    pixels_per_line = physical_width & ~7
    left = (physical_width - pixels_per_line) // 2
    lines = int(11 * 300)
    return left, 0, pixels_per_line, lines


def default_ff680w_gray_jpeg_scan_plan(
    *,
    dpi: int = 300,
    buffer_size: int = 65536,
    filter_sequence_type: int | None = None,
) -> GrayJpegScanPlan:
    """Return the current vendor-driven FF-680W grayscale JPEG scan plan."""

    if dpi not in SUPPORTED_INPUT_RESOLUTIONS:
        raise ValueError(f"unsupported input DPI for FF-680W: {dpi}")
    if dpi != 300:
        raise ValueError("only 300 DPI has been validated on hardware right now")

    filter_type = (
        default_filter_sequence_type() if filter_sequence_type is None else filter_sequence_type
    )
    filter_sequences = filter_sequence_table_map()
    if filter_type not in filter_sequences:
        raise ValueError(f"unsupported filter sequence type for FF-680W: {filter_type}")

    return GrayJpegScanPlan(
        dpi=dpi,
        buffer_size=buffer_size,
        acquisition=letter_scan_area_300dpi_centered(),
        source_tag="#ADF",
        color_mode_tag="#COLM008",
        format_tag="#FMTJPG #JPGd090",
        gamma_mode_tag="#GMMUG18",
        tone_mode_tag="#GMTMONOh100",
        mechanical_actions=default_adf_mechanical_actions(),
        filter_sequence_type=filter_type,
        filter_sequence_table_id=filter_sequences[filter_type],
        profile_table_id=table_id("Profile"),
        gray_balance_table_id=table_id("GrayBalanceGamma"),
        default_lut_table_id=table_id("DefaultLUT"),
        resolution_table_id=table_id("Resolution"),
        default_scan_mode=ES0170_HARDWARE_INFO["ESDefaultScanMode"],
        document_mode=ES0170_HARDWARE_INFO["ESDocumentMode"],
        auto_detect_long_paper=bool(ES0170_HARDWARE_INFO["ESAutoDetectLongPaper"]),
        default_double_feed_detection=bool(
            ES0170_HARDWARE_INFO["ESDefaultDetectDoubleFeed"]
        ),
        carrier_sheet_mode=ES0170_HARDWARE_INFO["ESCarrierSheet"],
    )


def build_ff680w_gray_jpeg_payload(*, dpi: int = 300, buffer_size: int = 65536) -> bytes:
    """Build the grayscale JPEG PARA payload that the real FF-680W accepted."""

    return default_ff680w_gray_jpeg_scan_plan(
        dpi=dpi,
        buffer_size=buffer_size,
    ).to_payload()
