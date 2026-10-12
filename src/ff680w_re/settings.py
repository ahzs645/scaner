"""Read-only inventory of the device's reported settings and host feature gaps."""
from __future__ import annotations

import hashlib
import re

from .session import EscI2Session

HOST_FEATURES = [
    'Automatic image rotation', 'Content-based deskew', 'Blank-page removal',
    'Brightness/contrast and gamma adjustment on the host', 'Text enhancement',
    'Background removal', 'Color dropout/enhancement', 'Unsharp mask',
    'Descreening', 'Edge fill', 'Punch-hole removal', 'OCR/searchable PDF',
    'PDF/TIFF export', 'FastFoto faded-color/red-eye restoration',
    'FastFoto original/enhanced copies and conditional back-side saving',
]


def describe_reply(reply):
    tokens = []
    for token in reply.tokens:
        value = {'name': token.name}
        if (token.name == 'GMT' and len(token.raw_value) >= 8
                and token.raw_value[4:5] == b'h'):
            lut = token.raw_value[8:]
            value.update(channel=token.raw_value[:4].decode('ascii').strip(),
                         binary_bytes=len(lut), sha256=hashlib.sha256(lut).hexdigest())
        else:
            value['value'] = token.text
        tokens.append(value)
    return {'tokens': tokens, 'header_hex': reply.header_block.hex(),
            'data_hex': reply.data_block.hex()}


def read_scanner_settings(session: EscI2Session):
    replies = {'identity': session.info(), 'capabilities': session.capabilities(),
               'current': session.resolutions(), 'status': session.status()}
    capability_tokens = replies['capabilities'].tokens
    dpi_values = []
    for token in capability_tokens:
        if token.name == 'RSM':
            dpi_values.extend(int(x) for x in re.findall(r'd(\d{3})', token.text))
    return {
        'model': 'Epson FF-680W',
        'device': {name: describe_reply(reply) for name, reply in replies.items()},
        'custom_controls': {
            'mode': {'choices': ['color', 'gray']},
            'duplex': {'choices': [False, True]},
            'dpi': {'choices': dpi_values},
            'sheets': {'zero_means': 'all loaded sheets', 'one_means': 'request one physical sheet'},
            'paper': {'choices': ['letter', 'a4', 'legal']},
            'quality': {'min': 1, 'max': 100},
            'deskew': {'kind': 'device paper skew correction'},
            'auto_crop': {'kind': 'device crop with paper-end detection', 'dpi': [300, 600]},
            'double_feed': {'kind': 'DFL1 ultrasonic mode'},
        },
        'host_features_not_implemented': HOST_FEATURES,
        'limits': [
            'Device capabilities do not establish all Epson application features.',
            '600 dpi is the maximum advertised optical acquisition resolution.',
            'Reading settings does not alter persistent device/maintenance preferences.',
            'Supported controls still require individual hardware validation.',
        ],
    }
