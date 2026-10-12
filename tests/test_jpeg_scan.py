from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ff680w_re.errors import ProtocolError
from ff680w_re.models import EscI2ImageBlock, EscI2Reply, EscI2Token
from ff680w_re.profiles import default_ff680w_jpeg_scan_plan
from ff680w_re.scan import run_jpeg_scan


def block(data=b'', **tokens):
    return EscI2ImageBlock(
        header_block=b'IMG ', data_block=data,
        tokens=[EscI2Token(k, v.encode()) for k, v in tokens.items()],
    )


class FakeSession:
    def __init__(self, blocks, para_ok=True):
        self.blocks = iter(blocks)
        self.calls = []
        self.para_ok = para_ok

    def status(self):
        return EscI2Reply('STAT', b'STAT')

    def mechanical(self, action):
        return EscI2Reply('MECH', b'MECH')

    def set_parameters(self, payload):
        self.calls.append('PARA')
        self.payload = payload
        return EscI2Reply('PARA', b'PARA', tokens=[EscI2Token('par', b'OK  ' if self.para_ok else b'FAIL')])

    def transfer_data_ready(self):
        self.calls.append('TRDT')
        return EscI2Reply('TRDT', b'TRDT')

    def image_block(self):
        return next(self.blocks)

    def cancel(self):
        self.calls.append('CAN')
        return EscI2Reply('CAN ', b'CAN ')

    def finish(self):
        self.calls.append('FIN')
        return EscI2Reply('FIN ', b'FIN ')


class JpegScanTests(unittest.TestCase):
    def test_ordinary_scan_does_not_issue_manual_load_unsupported_by_ff680w_capa(self):
        session = FakeSession([block(b'\xff\xd8page\xff\xd9', typ='IMGA', pen='end', lft='d000')])
        # The captured FF-680W reply advertises EJCT but no LOAD. Normal scans
        # must not infer a manual LOAD from DocumentMode or resource metadata.
        session.capabilities = lambda: EscI2Reply('CAPA', b'CAPA', tokens=[EscI2Token('ADF', b'EJCT')])
        with tempfile.TemporaryDirectory() as temp, patch.object(session, 'mechanical', side_effect=AssertionError('manual feeder action during ordinary scan')) as mechanical:
            images = run_jpeg_scan(session, output_dir=Path(temp) / 'new-job', idle_delay_ms=0)
            self.assertEqual(len(images), 1)
            mechanical.assert_not_called()
        self.assertEqual(session.calls, ['PARA', 'TRDT', 'FIN'])

    def test_two_sheet_duplex_job_keeps_four_streams_in_sheet_order(self):
        first_front = b'\xff\xd8first front\xff\xd9'
        first_back = b'\xff\xd8first back\xff\xd9'
        second_front = b'\xff\xd8second front\xff\xd9'
        second_back = b'\xff\xd8second back\xff\xd9'
        session = FakeSession([
            block(first_front, typ='IMGA', pen='end', lft='d003'),
            block(first_back, typ='IMGB', pen='end', lft='d002'),
            block(second_front[:-2], typ='IMGA'),
            block(second_back[:-2], typ='IMGB'),
            block(b'\xff\xd9', typ='IMGA', pen='end', lft='d001'),
            block(b'\xff\xd9', typ='IMGB', pen='end', lft='d000'),
        ])
        with tempfile.TemporaryDirectory() as temp:
            images = run_jpeg_scan(session, output_dir=Path(temp) / 'batch', duplex=True, idle_delay_ms=0)
            self.assertEqual([(i.sheet, i.side) for i in images], [(1, 'front'), (1, 'back'), (2, 'front'), (2, 'back')])
            self.assertEqual([i.path.read_bytes() for i in images], [first_front, first_back, second_front, second_back])
            self.assertEqual([i.path.name for i in images], ['001-front.jpg', '001-back.jpg', '002-front.jpg', '002-back.jpg'])
        self.assertIn(b'#PAGd000', session.payload)
        self.assertEqual(session.calls, ['PARA', 'TRDT', 'FIN'])

    def test_completed_page_does_not_end_job_without_zero_remaining_token(self):
        session = FakeSession([
            block(b'\xff\xd8page\xff\xd9', typ='IMGA', pen='end', lft='d001'),
            block(),
        ])
        with tempfile.TemporaryDirectory() as temp, patch('ff680w_re.scan.monotonic', side_effect=[0, 0, 0, 2]):
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'timed out'):
                run_jpeg_scan(session, output_dir=output, timeout=1, idle_delay_ms=0)
            self.assertEqual((output / '001-front.jpg').read_bytes(), b'\xff\xd8page\xff\xd9')
        self.assertEqual(session.calls[-2:], ['CAN', 'FIN'])

    def test_job_end_with_unfinished_second_sheet_preserves_completed_first_sheet(self):
        session = FakeSession([
            block(b'\xff\xd8one\xff\xd9', typ='IMGA', pen='end'),
            block(b'\xff\xd8two', typ='IMGA', lft='d000'),
        ])
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'incomplete or missing.*Saved 1 completed'):
                run_jpeg_scan(session, output_dir=output, idle_delay_ms=0)
            self.assertEqual((output / '001-front.jpg').read_bytes(), b'\xff\xd8one\xff\xd9')
            self.assertFalse((output / '002-front.jpg').exists())
        self.assertEqual(session.calls[-1], 'FIN')

    def test_scanner_exceeding_sheet_limit_is_error_instead_of_silent_truncation(self):
        session = FakeSession([
            block(b'\xff\xd8one\xff\xd9', typ='IMGA', pen='end', lft='d001'),
            block(b'\xff\xd8two\xff\xd9', typ='IMGA', pen='end', lft='d000'),
        ])
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'exceeded'):
                run_jpeg_scan(session, output_dir=output, max_sheets=1, idle_delay_ms=0)
            self.assertEqual(len(list(output.glob('*.jpg'))), 2)
        self.assertIn(b'#PAGd001', session.payload)

    def test_single_duplex_sheet_requests_two_images_and_returns_both(self):
        session = FakeSession([
            block(b'\xff\xd8front\xff\xd9', typ='IMGA', pen='end'),
            block(b'\xff\xd8back\xff\xd9', typ='IMGB', pen='end', lft='d000'),
        ])
        with tempfile.TemporaryDirectory() as temp:
            images = run_jpeg_scan(session, output_dir=Path(temp) / 'one', duplex=True, max_sheets=1, idle_delay_ms=0)
            self.assertEqual([(i.sheet, i.side) for i in images], [(1, 'front'), (1, 'back')])
        self.assertIn(b'#PAGd002', session.payload)

    def test_invalid_settings_fail_before_output_reservation_or_scanner_commands(self):
        for settings in ({'quality': 101}, {'duplex': True, 'max_sheets': 500}, {'dpi': 4800}):
            with self.subTest(settings=settings), tempfile.TemporaryDirectory() as temp:
                session = FakeSession([])
                output = Path(temp) / 'new-job'
                with self.assertRaises(ProtocolError):
                    run_jpeg_scan(session, output_dir=output, **settings)
                self.assertFalse(output.exists())
                self.assertEqual(session.calls, [])

    def test_interleaved_duplex_separates_sides_and_drains_page_end_payload(self):
        session = FakeSession([
            block(b'\xff\xd8front', typ='IMGA', pst='i0002544i0000000i0003300'),
            block(b'\xff\xd8back', typ='IMGB'),
            block(b'\xff\xd9', pen='i0002544i0003300', lft='d001', typ='IMGA'),
            block(b'\xff\xd9', pen='i0002544i0003300', typ='IMGB', lft='d000'),
        ])
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            images = run_jpeg_scan(session, output_dir=output, duplex=True, idle_delay_ms=0)
            self.assertEqual([i.side for i in images], ['front', 'back'])
            self.assertEqual(images[0].path.read_bytes(), b'\xff\xd8front\xff\xd9')
            self.assertEqual(images[1].path.read_bytes(), b'\xff\xd8back\xff\xd9')
        self.assertEqual(session.calls, ['PARA', 'TRDT', 'FIN'])
        self.assertIn(b'#ADFDPLXDFL1#COLC024', session.payload)

    def test_rejected_parameters_never_start_scan_or_write_output(self):
        session = FakeSession([], para_ok=False)
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'accept'):
                run_jpeg_scan(session, output_dir=output)
            self.assertFalse(output.exists())
        self.assertEqual(session.calls, ['PARA', 'FIN'])

    def test_missing_back_is_failure_even_with_job_end(self):
        session = FakeSession([block(b'\xff\xd8front\xff\xd9', typ='IMGA', pen='end', lft='d000')])
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'matching front and back'):
                run_jpeg_scan(session, output_dir=output, duplex=True)
            self.assertEqual((output / '001-front.jpg').read_bytes(), b'\xff\xd8front\xff\xd9')
        self.assertEqual(session.calls[-1], 'FIN')

    def test_page_is_saved_before_next_transfer_and_retained_after_jam(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            def transfers():
                yield block(b'\xff\xd8first\xff\xd9', typ='IMGA', pen='end')
                # This assertion happens during the next USB read, proving the
                # completed page was persisted before the batch finished.
                self.assertEqual((output / '001-front.jpg').read_bytes(), b'\xff\xd8first\xff\xd9')
                yield block(ERR='ADF JAM ')
            session = FakeSession(transfers())
            with self.assertRaisesRegex(ProtocolError, 'ERR=ADF JAM.*Saved 1 completed') as failure:
                run_jpeg_scan(session, output_dir=output, idle_delay_ms=0)
            self.assertIn(str(output), str(failure.exception))
            self.assertEqual([p.name for p in output.iterdir()], ['001-front.jpg'])
        self.assertEqual(session.calls[-2:], ['CAN', 'FIN'])

    def test_uppercase_empty_feeder_status_fails_before_start(self):
        session = FakeSession([])
        session.status = lambda: EscI2Reply('STAT', b'STAT', tokens=[EscI2Token('ERR', b'ADF PE ')] )
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'scanner status: ERR=ADF PE'):
                run_jpeg_scan(session, output_dir=output)
            self.assertFalse(output.exists())
        self.assertEqual(session.calls, ['FIN'])

    def test_finalize_failure_is_reported_with_saved_folder_after_complete_job(self):
        for failure_kind in ('exception', 'error token'):
            with self.subTest(failure_kind=failure_kind), tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / 'new-job'
                session = FakeSession([block(b'\xff\xd8page\xff\xd9', typ='IMGA', pen='end', lft='d000')])
                def failed_finish():
                    session.calls.append('FIN')
                    if failure_kind == 'exception':
                        raise ProtocolError('finalize transport broke')
                    return EscI2Reply('FIN ', b'FIN ', tokens=[EscI2Token('ERR', b'FAIL')])
                session.finish = failed_finish
                with self.assertRaisesRegex(ProtocolError, 'cleanup failed.*FIN:.*Saved 1 completed') as failure:
                    run_jpeg_scan(session, output_dir=output, idle_delay_ms=0)
                self.assertIn(str(output), str(failure.exception))
                self.assertEqual((output / '001-front.jpg').read_bytes(), b'\xff\xd8page\xff\xd9')
                self.assertEqual(session.calls, ['PARA', 'TRDT', 'FIN'])

    def test_cleanup_errors_keep_primary_jam_and_attempt_both_cleanup_steps(self):
        session = FakeSession([block(ERR='ADF JAM ')])
        def failed_cancel():
            session.calls.append('CAN')
            raise ProtocolError('cancel failed')
        def failed_finish():
            session.calls.append('FIN')
            raise ProtocolError('finalize failed')
        session.cancel = failed_cancel
        session.finish = failed_finish
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'image transfer: ERR=ADF JAM.*CAN: cancel failed.*FIN: finalize failed') as failure:
                run_jpeg_scan(session, output_dir=output, idle_delay_ms=0)
            self.assertIn('ADF JAM', str(failure.exception.__cause__))
            self.assertFalse(output.exists())
        self.assertEqual(session.calls, ['PARA', 'TRDT', 'CAN', 'FIN'])

    def test_start_request_failure_still_attempts_cancel_and_finalize(self):
        session = FakeSession([])
        def failed_start():
            session.calls.append('TRDT')
            raise ProtocolError('start reply lost')
        session.transfer_data_ready = failed_start
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'start reply lost'):
                run_jpeg_scan(session, output_dir=output)
            self.assertFalse(output.exists())
        self.assertEqual(session.calls, ['PARA', 'TRDT', 'CAN', 'FIN'])

    def test_sheet_limit_stops_immediately_on_either_side_without_reading_remaining_job(self):
        for side in ('front', 'back'):
            with self.subTest(side=side), tempfile.TemporaryDirectory() as temp:
                output = Path(temp) / 'new-job'
                reads = []
                def transfers():
                    for index in range(3):
                        reads.append(index)
                        yield block(b'\xff\xd8page\xff\xd9', typ='IMGA' if side == 'front' else 'IMGB', pen='end', lft='d001')
                session = FakeSession(transfers())
                with self.assertRaisesRegex(ProtocolError, f'exceeded.*{side} side.*Saved 2 completed'):
                    run_jpeg_scan(session, output_dir=output, duplex=True, max_sheets=1, idle_delay_ms=0)
                self.assertEqual(reads, [0, 1])
                self.assertEqual([p.name for p in sorted(output.glob('*.jpg'))], [f'001-{side}.jpg', f'002-{side}.jpg'])
                self.assertEqual(session.calls, ['PARA', 'TRDT', 'CAN', 'FIN'])

    def test_reverse_side_arriving_first_still_returns_front_then_back(self):
        session = FakeSession([
            block(b'\xff\xd8back\xff\xd9', typ='IMGB', pen='end'),
            block(b'\xff\xd8front\xff\xd9', typ='IMGA', pen='end', lft='d000'),
        ])
        with tempfile.TemporaryDirectory() as temp:
            images = run_jpeg_scan(session, output_dir=Path(temp) / 'new-job', duplex=True, idle_delay_ms=0)
            self.assertEqual([i.side for i in images], ['front', 'back'])
            self.assertEqual([i.path.read_bytes() for i in images], [b'\xff\xd8front\xff\xd9', b'\xff\xd8back\xff\xd9'])

    def test_exclusive_save_collision_preserves_existing_file_and_prior_image(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'new-job'
            def transfers():
                yield block(b'\xff\xd8first\xff\xd9', typ='IMGA', pen='end')
                (output / '002-front.jpg').write_bytes(b'keep existing file')
                yield block(b'\xff\xd8second\xff\xd9', typ='IMGA', pen='end')
            session = FakeSession(transfers())
            with self.assertRaisesRegex(ProtocolError, 'cannot save completed scan.*Saved 1 completed'):
                run_jpeg_scan(session, output_dir=output, idle_delay_ms=0)
            self.assertEqual((output / '001-front.jpg').read_bytes(), b'\xff\xd8first\xff\xd9')
            self.assertEqual((output / '002-front.jpg').read_bytes(), b'keep existing file')
        self.assertEqual(session.calls[-2:], ['CAN', 'FIN'])

    def test_timeout_cancels_and_finalizes(self):
        session = FakeSession([block()])
        with tempfile.TemporaryDirectory() as temp, patch('ff680w_re.scan.monotonic', side_effect=[0, 0, 2]):
            output = Path(temp) / 'new-job'
            with self.assertRaisesRegex(ProtocolError, 'timed out'):
                run_jpeg_scan(session, output_dir=output, timeout=1, idle_delay_ms=0)
            self.assertFalse(output.exists())
        self.assertEqual(session.calls[-2:], ['CAN', 'FIN'])

    def test_incomplete_jpeg_is_failure(self):
        session = FakeSession([block(b'\xff\xd8truncated', pen='end')])
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ProtocolError, 'incomplete JPEG'):
                run_jpeg_scan(session, output_dir=Path(temp) / 'new-job')
        self.assertEqual(session.calls[-2:], ['CAN', 'FIN'])

    def test_existing_output_is_preserved_before_any_scanner_commands(self):
        session = FakeSession([])
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            saved = output / '001-front.jpg'
            saved.write_bytes(b'existing scan')
            with self.assertRaisesRegex(ProtocolError, 'already exists'):
                run_jpeg_scan(session, output_dir=output)
            self.assertEqual(saved.read_bytes(), b'existing scan')
        self.assertEqual(session.calls, [])

    def test_color_luts_preserve_all_binary_values_in_each_channel(self):
        payload = default_ff680w_jpeg_scan_plan().to_payload()
        for channel in (b'RED ', b'GRN ', b'BLU '):
            self.assertIn(b'#GMT' + channel + b'h100' + bytes(range(256)), payload)
        self.assertIn(b'#COLC024#FMTJPG ', payload)

    def test_invalid_output_parent_fails_before_scanner_commands(self):
        session = FakeSession([])
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp) / 'file'
            parent.write_bytes(b'keep')
            with self.assertRaisesRegex(ProtocolError, 'prepare scan output'):
                run_jpeg_scan(session, output_dir=parent / 'new-job')
            self.assertEqual(parent.read_bytes(), b'keep')
        self.assertEqual(session.calls, [])


if __name__ == '__main__':
    unittest.main()
