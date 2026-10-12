from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from threading import Thread
import unittest

from ff680w_re.browser import create_server, MAX_IMAGE_BYTES, MAX_JSON_BYTES


class BrowserServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = TemporaryDirectory()
        cls.root = Path(cls.temporary.name) / 'scans'
        cls.server = create_server(cls.root, port=0)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.host = f'127.0.0.1:{cls.server.server_address[1]}'
        cls.origin = f'http://{cls.host}'
        status, _, body = cls.request('GET', '/')
        assert status == 200
        cls.token = re.search(rb"window.launchToken='([^']+)'", body).group(1).decode()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temporary.cleanup()

    @classmethod
    def request(cls, method, path, body=None, headers=None):
        connection = HTTPConnection('127.0.0.1', cls.server.server_address[1], timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def post(self, path, value=None, headers=None, raw=None):
        merged = {'Origin': self.origin, 'X-Launch-Token': self.token,
                  'Content-Type': 'application/json' if raw is None else 'image/jpeg'}
        merged.update(headers or {})
        return self.request('POST', path, body=json.dumps(value).encode() if raw is None else raw, headers=merged)

    def new_job(self):
        status, _, body = self.post('/api/jobs', {})
        self.assertEqual(status, 201, body)
        return json.loads(body)

    def test_index_uses_fresh_launch_token_and_security_headers(self):
        status, headers, body = self.request('GET', '/')
        self.assertEqual(status, 200)
        self.assertNotIn(b'__LAUNCH_TOKEN__', body)
        self.assertIn(self.token.encode(), body)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])
        self.assertNotIn('Access-Control-Allow-Origin', headers)

    def test_host_validation_for_read_and_write(self):
        for host in ('localhost:' + str(self.server.server_address[1]), 'evil.example', self.host + '.evil.example'):
            with self.subTest(host=host):
                self.assertEqual(self.request('GET', '/', headers={'Host': host})[0], 403)
                self.assertEqual(self.post('/api/jobs', {}, headers={'Host': host})[0], 403)

    def test_origin_and_token_required_for_mutations(self):
        cases = [{'Origin': ''}, {'Origin': 'null'}, {'Origin': 'https://evil.example'},
                 {'X-Launch-Token': ''}, {'X-Launch-Token': 'wrong'}, {'X-Launch-Token': 'é'}]
        before = set(self.root.iterdir()) if self.root.exists() else set()
        for headers in cases:
            with self.subTest(headers=headers):
                self.assertEqual(self.post('/api/jobs', {}, headers=headers)[0], 403)
        self.assertEqual(self.request('POST', '/api/jobs', body=b'{}', headers={'Content-Type': 'application/json'})[0], 403)
        after = set(self.root.iterdir()) if self.root.exists() else set()
        self.assertEqual(before, after)
        self.assertEqual(self.request('GET', '/', headers={'Origin': 'https://evil.example'})[0], 403)

    def test_duplicate_security_headers_rejected(self):
        for duplicate in ('Host', 'Origin', 'X-Launch-Token'):
            with self.subTest(duplicate=duplicate):
                connection = HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=3)
                try:
                    connection.putrequest('POST', '/api/jobs', skip_host=True)
                    values = {'Host': self.host, 'Origin': self.origin, 'X-Launch-Token': self.token,
                              'Content-Type': 'application/json', 'Content-Length': '2'}
                    for name, value in values.items():
                        connection.putheader(name, value)
                    connection.putheader(duplicate, values[duplicate])
                    connection.endheaders(b'{}')
                    response = connection.getresponse()
                    self.assertEqual(response.status, 403)
                    response.read()
                finally:
                    connection.close()

    def test_valid_plan_with_duplex_sheet_limit(self):
        status, _, body = self.post('/api/plan', {'mode': 'color', 'duplex': True, 'max_sheets': 2, 'dpi': 300})
        self.assertEqual(status, 200, body)
        result = json.loads(body)
        payload = bytes.fromhex(result['payload_hex'])
        self.assertIn(b'#PAGd004', payload)
        self.assertIn(b'#COLC024', payload)
        self.assertEqual(result['summary']['image_count_limit'], 4)
        self.assertIn('host_features_not_implemented', result)

    def test_malformed_plans_return_errors_and_service_remains_available(self):
        cases = [None, [], 'color', 1, {'unknown': 1}, {'mode': []}, {'mode': 'mono'},
                 {'dpi': True}, {'dpi': 300.0}, {'dpi': 1200}, {'quality': 0}, {'quality': '90'},
                 {'max_sheets': -1}, {'max_sheets': 1.5}, {'max_sheets': 500, 'duplex': True},
                 {'duplex': 'false'}, {'double_feed': 1}, {'auto_crop': None}, {'paper': {}}]
        for settings in cases:
            with self.subTest(settings=settings):
                status, _, body = self.post('/api/plan', settings)
                self.assertEqual(status, 400, body)
                self.assertIn('error', json.loads(body))
        for body in (b'not-json', b'{', b'\xff'):
            self.assertEqual(self.post('/api/plan', raw=body, headers={'Content-Type': 'application/json'})[0], 400)
        self.assertEqual(self.post('/api/plan', {})[0], 200)

    def test_request_framing_and_content_type_limits(self):
        for headers, expected in [({'Content-Length': '-1'}, 400), ({'Content-Length': 'wat'}, 400),
                                  ({'Content-Length': '0'}, 413), ({'Transfer-Encoding': 'chunked'}, 400),
                                  ({'Content-Length': str(MAX_JSON_BYTES + 1)}, 413),
                                  ({'Content-Type': 'text/plain'}, 415)]:
            with self.subTest(headers=headers):
                self.assertEqual(self.post('/api/plan', {}, headers=headers)[0], expected)
        job = self.new_job()
        self.assertEqual(self.post('/api/jobs/' + job['id'] + '/001-front.jpg', raw=b'abc',
                                   headers={'Content-Length': str(MAX_IMAGE_BYTES + 1)})[0], 413)

    def test_job_creation_rejects_malformed_requests(self):
        for value in (None, [], {'directory': '/tmp/override'}, 'x'):
            with self.subTest(value=value):
                self.assertEqual(self.post('/api/jobs', value)[0], 400)

    def test_unique_jobs_and_complete_images_preserve_previous_output(self):
        first, second = self.new_job(), self.new_job()
        self.assertNotEqual(first['id'], second['id'])
        # Marker-complete synthetic bodies exercise file handling, not JPEG decoding.
        original = b'\xff\xd8original\xff\xd9'
        changed = b'\xff\xd8changed\xff\xd9'
        route = '/api/jobs/' + first['id'] + '/001-front.jpg'
        status, _, body = self.post(route, raw=original)
        self.assertEqual(status, 201, body)
        saved = json.loads(body)
        self.assertEqual(self.post(route, raw=changed)[0], 409)
        self.assertEqual(Path(saved['file']).read_bytes(), original)
        self.assertEqual(self.request('GET', saved['url'])[2], original)
        self.assertEqual(self.post('/api/jobs/' + second['id'] + '/001-front.jpg', raw=changed)[0], 201)
        self.assertEqual((Path(second['directory']) / '001-front.jpg').read_bytes(), changed)
        self.assertFalse(list(Path(first['directory']).glob('.upload-*')))
        self.assertEqual(self.post('/api/jobs/' + first['id'] + '/001-back.jpg', raw=b'\xff\xd8partial')[0], 400)
        self.assertFalse((Path(first['directory']) / '001-back.jpg').exists())

    def test_paths_cannot_escape_jobs_or_reference_unknown_jobs(self):
        job = self.new_job()
        names = ('../outside.jpg', '%2e%2e%2foutside.jpg', '001-front.jpg/../x',
                 '001-front.jpg?x=1', '001-front.jpg%00', '%EF%BC%90%EF%BC%90%EF%BC%91-front.jpg')
        for name in names:
            with self.subTest(name=name):
                self.assertEqual(self.post('/api/jobs/' + job['id'] + '/' + name, raw=b'\xff\xd8\xff\xd9')[0], 400)
                self.assertEqual(self.request('GET', '/images/' + job['id'] + '/' + name)[0], 404)
        self.assertEqual(self.post('/api/jobs/missing/001-front.jpg', raw=b'\xff\xd8\xff\xd9')[0], 400)
        self.assertEqual(self.request('GET', '/images/missing/001-front.jpg')[0], 404)
        self.assertEqual(self.request('GET', '/../../pyproject.toml')[0], 404)

    def test_concurrent_duplicate_uploads_publish_one_complete_file(self):
        job = self.new_job()
        route = '/api/jobs/' + job['id'] + '/001-front.jpg'
        images = (b'\xff\xd8first\xff\xd9', b'\xff\xd8second\xff\xd9')
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda image: self.post(route, raw=image), images))
        self.assertEqual(sorted(result[0] for result in results), [201, 409])
        winner = next(image for image, result in zip(images, results) if result[0] == 201)
        self.assertEqual((Path(job['directory']) / '001-front.jpg').read_bytes(), winner)
        self.assertFalse(list(Path(job['directory']).glob('.upload-*')))

    def test_job_and_image_symlinks_are_not_followed(self):
        job = self.new_job()
        outside = Path(self.temporary.name) / 'outside.jpg'
        outside.write_bytes(b'private')
        image = Path(job['directory']) / '001-front.jpg'
        image.symlink_to(outside)
        self.assertEqual(self.request('GET', '/images/' + job['id'] + '/001-front.jpg')[0], 404)
        self.assertEqual(self.post('/api/jobs/' + job['id'] + '/001-front.jpg', raw=b'\xff\xd8\xff\xd9')[0], 409)
        self.assertEqual(outside.read_bytes(), b'private')
        image.unlink()
        Path(job['directory']).rmdir()
        Path(job['directory']).symlink_to(outside.parent, target_is_directory=True)
        self.assertEqual(self.request('GET', '/images/' + job['id'] + '/001-front.jpg')[0], 404)
        self.assertEqual(self.post('/api/jobs/' + job['id'] + '/001-back.jpg', raw=b'\xff\xd8\xff\xd9')[0], 400)
        self.assertFalse((outside.parent / '001-back.jpg').exists())

    def test_static_assets_and_unknown_routes(self):
        for path in ('/app.js', '/protocol.js'):
            with self.subTest(path=path):
                status, headers, _ = self.request('GET', path)
                self.assertEqual(status, 200)
                self.assertIn('javascript', headers['Content-Type'])
        self.assertEqual(self.request('GET', '/favicon.ico')[0], 404)
        self.assertEqual(self.post('/api/unknown', {})[0], 404)


if __name__ == '__main__':
    unittest.main()
