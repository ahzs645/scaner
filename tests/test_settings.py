import unittest

from ff680w_re.models import EscI2Reply, EscI2Token
from ff680w_re.settings import describe_reply


class SettingsTests(unittest.TestCase):
    def test_tone_capability_list_is_text_and_current_tone_table_is_binary(self):
        reply = EscI2Reply('RESA', b'RESA', tokens=[
            EscI2Token('GMT', b'LISTRED GRN BLU MONO'),
            EscI2Token('GMT', b'RED h100' + bytes(range(256))),
        ])
        values = describe_reply(reply)['tokens']
        self.assertEqual(values[0], {'name': 'GMT', 'value': 'LISTRED GRN BLU MONO'})
        self.assertEqual(values[1]['channel'], 'RED')
        self.assertEqual(values[1]['binary_bytes'], 256)
        self.assertEqual(len(values[1]['sha256']), 64)
