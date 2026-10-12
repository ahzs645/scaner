"""Vendored Epson Scan 2 model and table data for FF-680W research.

These values were transcribed from the user's locally expanded Epson packages so
the scaffold can reason about FF-680W defaults without depending on `/tmp` or
installed Epson software at runtime.
"""

from __future__ import annotations

SOURCE_PATHS = {
    "es0170_plist": (
        "/tmp/ff680w-es2/Epson_Scan_2.pkg/Payload/Library/Image Capture/Support/"
        "EPSON/Epson Scan 2/Models/ES0170/ES0170.bundle/Contents/Resources/ALL/"
        "ES0170.plist"
    ),
    "convert_table": (
        "/tmp/ff680w-es2/Epson_Scan_2.pkg/Payload/Library/Image Capture/Support/"
        "EPSON/Epson Scan 2/Models/ES0170/ES0170.bundle/Contents/Resources/"
        "ConvertTable.plist"
    ),
    "profile_0082": (
        "/tmp/ff680w-es2/Epson_Scan_2.pkg/Payload/Library/Image Capture/Support/"
        "EPSON/Epson Scan 2/Models/Common/Tables/Profile.bundle/Contents/"
        "Resources/Profile/ESProfile0082.plist"
    ),
    "profile_1047": (
        "/tmp/ff680w-es2/Epson_Scan_2.pkg/Payload/Library/Image Capture/Support/"
        "EPSON/Epson Scan 2/Models/Common/Tables/Profile.bundle/Contents/"
        "Resources/Profile/ESProfile1047.plist"
    ),
    "lut_0016": (
        "/tmp/ff680w-es2/Epson_Scan_2.pkg/Payload/Library/Image Capture/Support/"
        "EPSON/Epson Scan 2/Models/Common/Tables/LUT.bundle/Contents/Resources/"
        "LUT/ESLUT0016.plist"
    ),
    "resolution_0162": (
        "/tmp/ff680w-es2/Epson_Scan_2.pkg/Payload/Library/Image Capture/Support/"
        "EPSON/Epson Scan 2/Models/Common/Tables/Resolution.bundle/Contents/"
        "Resources/Resolution/ESResolution0162.plist"
    ),
    "xiop": (
        "/tmp/ff680w-es2/Epson_Scan_2_2.pkg/Payload/Library/Image Capture/Support/"
        "EPSON/Epson Scan 2/Core/EpsonScan2.framework/Versions/A/Resources/"
        "XIOP.plugin/Contents/MacOS/XIOP"
    ),
}

ES0170_HARDWARE_INFO = {
    "ESADFCard": 3,
    "ESADFHeightMax": 60960,
    "ESADFHeightMin": 508,
    "ESADFOffset": 2,
    "ESADFPixel": {"Main": 0, "Sub": 0},
    "ESADFWidthMin": 508,
    "ESAutoDetectLongPaper": 1,
    "ESBitDepth": 3,
    "ESCarrierSheet": 2,
    "ESCleaningAlertLimitCount": 5000,
    "ESColorEnhance": 1,
    "ESCommandType": 4,
    "ESConnectionType": 2,
    "ESDDEADF": 13,
    "ESDDEFlatbed": 13,
    "ESDDEName": "EsDDE4",
    "ESDefaultDetectDoubleFeed": 1,
    "ESDefaultScanMode": 0,
    "ESDocumentMode": 1,
    "ESDropOut": 1,
    "ESDTRName": "DTR2",
    "ESDustRemoval": 1,
    "ESEdgeFillLevelBottom": 3,
    "ESEdgeFillLevelLeft": 3,
    "ESEdgeFillLevelRight": 3,
    "ESEdgeFillLevelTop": 3,
    "ESEncryptPDF": 1,
    "ESFilmSize": 0,
    "ESFilmSizeRange": 0,
    "ESFITName": "FIT",
    "ESFlatbedOffset": 0,
    "ESFlatbedType": 0,
    "ESGamma": 2.2,
    "ESGlassDirtyDetection": 1,
    "ESHolderRange": 0,
    "ESIconFileName": "ES0170",
    "ESImageFilterName": "Image Filter5",
    "ESInterrupt": 1,
    "ESIPv6": 1,
    "ESKind": 11,
    "ESLandscapeDirection": 0,
    "ESModeDefault": 1,
    "ESModelID": "0170",
    "ESModelName": "EPSON FF-680W",
    "ESNetworkEnergySave": 1,
    "ESOCRName": "Ocrsys",
    "ESPDFExtentionName": "epdfcihr",
    "ESPDFLibName": "PDFLib",
    "ESPowerOffTimer": 1,
    "ESProductID": "016B",
    "ESProductName": ["FF-680W"],
    "ESProtocol": 1,
    "ESPushScanEventDestination": {
        "JP": "com.epson.EventManager",
        "US": "com.epson.EventManager",
        "WW": "com.epson.EventManager",
    },
    "ESQuietModeType": 0,
    "ESRemovePunchHole": 2,
    "ESResolution": {"Max": 4800, "Min": 50, "Moire": 600, "Reflection": 600},
    "ESRollerCount": 1,
    "ESShowGlassDirtyDetectLevel": 1,
    "ESSleepTime": 1,
    "ESStandardPreset": [14, 15],
    "ESSWAutoSize": 1,
    "ESTPU2Bit": 0,
    "ESTWAINID": ["EPSON FF-680W"],
}

ES0170_TABLE_INFO = {
    "ClipConst": ["ESClipConst0001"],
    "ClipCorrect": ["ESClipCorrect0000"],
    "ClipRevise": ["ESClipRevise0005"],
    "DefaultLUT": ["ESLUT0016"],
    "DustRemoval": ["ESDustRemoval0000"],
    "FilterSequence": [
        "ESFilterSequence0000",
        "ESFilterSequence0002",
        "ESFilterSequence0004",
        "ESFilterSequence0101",
    ],
    "GrayBalanceGamma": ["ESProfile1047"],
    "MaxResolution": ["ESMaxResolution0000"],
    "Moire": ["ESMoire2004", "ESMoire2005", "ESMoire2006"],
    "PreviewBW": ["ESPreviewBW0002"],
    "Profile": ["ESProfile0082"],
    "Resolution": ["ESResolution0162"],
    "USMBlur": ["ESUSMBlur0000"],
    "USMNoise": ["ESUSMNoise0002"],
    "USMOperation": ["ESUSM0008"],
}

ES0170_CONVERT_TABLE = {
    "ClipConst": [
        {"SetParam": {"ESClipConstTable": "ESClipConst0001"}},
    ],
    "ClipCorrect": [
        {"SetParam": {"ESClipCorrectTable": "ESClipCorrect0000"}},
    ],
    "ClipRevise": [
        {"SetParam": {"ESClipReviseTable": "ESClipRevise0005"}},
    ],
    "DefaultLUT": [
        {
            "ConditionParam": {"ESCurrentMode": [1]},
            "SetParam": {"ESDefaultLUTTable": "ESLUT0016"},
        }
    ],
    "DustRemoval": [
        {
            "ConditionParam": {"DocumentType": [0]},
            "SetParam": {"ESDustRemovalTable": "ESDustRemoval0000"},
        }
    ],
    "FilterSequence": [
        {
            "ConditionParam": {"FilterSequenceType": [0]},
            "SetParam": {"ESFilterSequenceTable": "ESFilterSequence0101"},
        },
        {
            "ConditionParam": {"FilterSequenceType": [1]},
            "SetParam": {"ESFilterSequenceTable": "ESFilterSequence0002"},
        },
        {
            "ConditionParam": {"FilterSequenceType": [2]},
            "SetParam": {"ESFilterSequenceTable": "ESFilterSequence0004"},
        },
        {
            "ConditionParam": {"FilterSequenceType": [4]},
            "SetParam": {"ESFilterSequenceTable": "ESFilterSequence0000"},
        },
    ],
    "GrayBalanceGamma": [
        {"SetParam": {"ESGrayBalanceGammaTable": "ESProfile1047"}},
    ],
    "MaxResolution": [
        {"SetParam": {"ESMaxResolutionTable": "ESMaxResolution0000"}},
    ],
    "Moire": [
        {
            "ConditionParam": {"Descreening": [1]},
            "SetParam": {"ESMoireTable": "ESMoire2004"},
        },
        {
            "ConditionParam": {"Descreening": [2]},
            "SetParam": {"ESMoireTable": "ESMoire2005"},
        },
        {
            "ConditionParam": {"Descreening": [3]},
            "SetParam": {"ESMoireTable": "ESMoire2006"},
        },
    ],
    "PreviewBW": [
        {
            "ConditionParam": {"SpeedPriority": [0]},
            "SetParam": {"ESPreviewBWTable": "ESPreviewBW0002"},
        }
    ],
    "Profile": [
        {"SetParam": {"ESProfileTable": "ESProfile0082"}},
    ],
    "Resolution": [
        {"SetParam": {"ESResolutionTable": "ESResolution0162"}},
    ],
    "USMBlur": [
        {"SetParam": {"ESUSMBlurTable": "ESUSMBlur0000"}},
    ],
    "USMNoise": [
        {"SetParam": {"ESUSMNoiseTable": "ESUSMNoise0002"}},
    ],
    "USMOperation": [
        {
            "ConditionParam": {"DocumentType": [0]},
            "SetParam": {"ESUSMTable": "ESUSM0008"},
        }
    ],
}

PROFILE_TABLES = {
    "ESProfile0082": {
        "Negative": {"B": [0, 0, 10000], "G": [0, 10000, 0], "R": [10000, 0, 0]},
        "Positive": {"B": [0, 0, 10000], "G": [0, 10000, 0], "R": [10000, 0, 0]},
        "Reflective": {
            "B": [44, -1150, 11106],
            "G": [31, 10287, -318],
            "R": [10229, 9, -238],
        },
    },
    "ESProfile1047": {
        "Negative": {"B": [0, 0, 10000], "G": [0, 10000, 0], "R": [10000, 0, 0]},
        "Positive": {"B": [0, 0, 10000], "G": [0, 10000, 0], "R": [10000, 0, 0]},
        "Reflective": {
            "B": [0, 0, 9940],
            "G": [0, 9940, 0],
            "R": [10120, 0, 0],
        },
    },
}

LUT_TABLES = {
    "ESLUT0016": {
        "blue": {
            "gamma": 1,
            "highlightIn": 210,
            "highlightOut": 255,
            "shadowIn": 50,
            "shadowOut": 10,
        },
        "green": {
            "gamma": 1,
            "highlightIn": 210,
            "highlightOut": 255,
            "shadowIn": 50,
            "shadowOut": 10,
        },
        "red": {
            "gamma": 1,
            "highlightIn": 210,
            "highlightOut": 255,
            "shadowIn": 50,
            "shadowOut": 10,
        },
        "ESPhotoHighlightCurve": 1,
        "ESPhotoShadowCurve": 2,
    }
}

RESOLUTION_TABLES = {
    "ESResolution0162": {
        "Input": [50, 75, 100, 150, 200, 240, 300, 360, 400, 9600],
        "Output": [50, 75, 100, 150, 200, 240, 300, 360, 400, 600],
    }
}

NETWORK_HINTS = {
    "source_path": SOURCE_PATHS["xiop"],
    "bonjour_services": ["_scanner._tcp"],
    "uri_formats": [
        'network epsontcpip://%s/%d "%s %s" "%s (IP)"',
        'network epsontcpip://%s/%d "%s %s" "%s (IP)" "%s"',
        'network epsontcpip://%s/%d "%s %s" "%s %s (IP)"',
        'network epsonpap://%s/%s/%s "%s %s" "%s (AT)"',
    ],
}

DEFAULT_FILTER_SEQUENCE_TYPE = 0


def table_id(name: str) -> str:
    """Return the primary Epson table id for a named model table."""

    return ES0170_TABLE_INFO[name][0]


def filter_sequence_table_map() -> dict[int, str]:
    """Return the FF-680W filter-sequence mapping from ConvertTable.plist."""

    mapping: dict[int, str] = {}
    for entry in ES0170_CONVERT_TABLE["FilterSequence"]:
        key = entry["ConditionParam"]["FilterSequenceType"][0]
        value = entry["SetParam"]["ESFilterSequenceTable"]
        mapping[key] = value
    return mapping


def default_filter_sequence_type() -> int:
    """Return Epson's default filter-sequence type for FF-680W document mode."""

    return DEFAULT_FILTER_SEQUENCE_TYPE


def default_adf_mechanical_actions() -> tuple[str, ...]:
    """Return the default ADF mechanical sequence implied by the vendor model."""

    if ES0170_HARDWARE_INFO["ESDocumentMode"]:
        return ("#ADFLOAD",)
    return ()


def supported_input_resolutions() -> tuple[int, ...]:
    """Return the vendored FF-680W input resolutions from Epson's table."""

    return tuple(RESOLUTION_TABLES[table_id("Resolution")]["Input"])


def supported_output_resolutions() -> tuple[int, ...]:
    """Return the vendored FF-680W output resolutions from Epson's table."""

    return tuple(RESOLUTION_TABLES[table_id("Resolution")]["Output"])


def vendor_summary() -> dict[str, object]:
    """Return a compact summary of the imported Epson model/table data."""

    return {
        "model_name": ES0170_HARDWARE_INFO["ESModelName"],
        "model_id": ES0170_HARDWARE_INFO["ESModelID"],
        "product_id": ES0170_HARDWARE_INFO["ESProductID"],
        "document_mode": ES0170_HARDWARE_INFO["ESDocumentMode"],
        "default_scan_mode": ES0170_HARDWARE_INFO["ESDefaultScanMode"],
        "carrier_sheet_mode": ES0170_HARDWARE_INFO["ESCarrierSheet"],
        "auto_detect_long_paper": bool(ES0170_HARDWARE_INFO["ESAutoDetectLongPaper"]),
        "default_double_feed_detection": bool(
            ES0170_HARDWARE_INFO["ESDefaultDetectDoubleFeed"]
        ),
        "command_type": ES0170_HARDWARE_INFO["ESCommandType"],
        "connection_type": ES0170_HARDWARE_INFO["ESConnectionType"],
        "profile_table_id": table_id("Profile"),
        "gray_balance_table_id": table_id("GrayBalanceGamma"),
        "default_lut_table_id": table_id("DefaultLUT"),
        "resolution_table_id": table_id("Resolution"),
        "filter_sequences": filter_sequence_table_map(),
        "input_resolutions": supported_input_resolutions(),
        "output_resolutions": supported_output_resolutions(),
        "sources": dict(SOURCE_PATHS),
    }
