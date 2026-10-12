"""Loopback-only UI and profile/file service; USB transfers happen in WebUSB."""
from __future__ import annotations

import argparse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets

from .profiles import default_ff680w_jpeg_scan_plan
from .settings import HOST_FEATURES

MAX_IMAGE_BYTES = 24 * 1024 * 1024
MAX_JSON_BYTES = 64 * 1024
IMAGE_NAME = re.compile(r'[0-9]{3}-(front|back)\.jpg')
SETTING_TYPES = {
    'mode': str, 'duplex': bool, 'dpi': int, 'max_sheets': int,
    'paper': str, 'quality': int, 'deskew': bool, 'auto_crop': bool,
    'double_feed': bool,
}


def validate_settings(settings):
    if not isinstance(settings, dict):
        raise ValueError('scan settings must be a JSON object')
    for name, value in settings.items():
        if name not in SETTING_TYPES:
            raise ValueError(f'unknown scan setting: {name}')
        # bool is an int subclass in Python; exact types prevent truthy strings,
        # float page counts, and booleans from becoming device parameters.
        if type(value) is not SETTING_TYPES[name]:
            raise ValueError(f'invalid type for scan setting: {name}')
    return settings


def create_server(output_root: Path, port: int = 8765) -> ThreadingHTTPServer:
    """Create a loopback server without starting it or accessing the scanner."""
    token = secrets.token_urlsafe(32)
    output_root = Path(output_root).resolve()
    jobs = {}
    assets = Path(__file__).parent / 'web'

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, *_):
            pass

        def respond(self, code, data, content_type='application/json'):
            body = json.dumps(data).encode() if content_type == 'application/json' else data
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def one_header(self, name):
            values = self.headers.get_all(name, [])
            return values[0] if len(values) == 1 else None

        def trusted(self):
            host = f'127.0.0.1:{self.server.server_address[1]}'
            if self.one_header('Host') != host:
                self.respond(403, {'error': 'invalid host'})
                return False
            origin = self.headers.get_all('Origin', [])
            if origin and self.one_header('Origin') != f'http://{host}':
                self.respond(403, {'error': 'use this local UI'})
                return False
            return True

        def job_file(self, prefix):
            parts = self.path.split('/')
            start = 3 if prefix == '/api/jobs/' else 2
            if len(parts) != start + 2 or parts[start] not in jobs or not IMAGE_NAME.fullmatch(parts[start + 1]):
                raise ValueError('invalid output')
            return jobs[parts[start]], parts[start + 1]

        def do_GET(self):
            if not self.trusted():
                return
            if self.path == '/':
                html = (assets / 'index.html').read_text().replace('__LAUNCH_TOKEN__', token)
                self.respond(200, html.encode(), 'text/html; charset=utf-8')
            elif self.path in ('/app.js', '/protocol.js'):
                try:
                    body = (assets / self.path[1:]).read_bytes()
                except OSError:
                    return self.respond(404, {'error': 'asset not found'})
                self.respond(200, body, 'text/javascript; charset=utf-8')
            elif self.path.startswith('/images/'):
                try:
                    directory, name = self.job_file('/images/')
                    # Do not follow symlinks placed inside a scan job or replacing it.
                    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    try:
                        image_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
                        with os.fdopen(image_fd, 'rb') as image:
                            body = image.read()
                    finally:
                        os.close(fd)
                except (ValueError, OSError):
                    return self.respond(404, {'error': 'image not found'})
                self.respond(200, body, 'image/jpeg')
            else:
                self.respond(404, {'error': 'not found'})

        def do_POST(self):
            if not self.trusted():
                return
            origin = f'http://127.0.0.1:{self.server.server_address[1]}'
            launch_token = self.one_header('X-Launch-Token')
            if self.one_header('Origin') != origin or launch_token is None or not secrets.compare_digest(launch_token.encode(), token.encode()):
                return self.respond(403, {'error': 'use this local UI'})
            is_image = self.path.startswith('/api/jobs/')
            if self.path not in ('/api/plan', '/api/jobs') and not is_image:
                return self.respond(404, {'error': 'not found'})
            try:
                if self.headers.get_all('Transfer-Encoding'):
                    raise ValueError('transfer encoding is not supported')
                length = self.one_header('Content-Length')
                if length is None or not re.fullmatch(r'[0-9]+', length):
                    raise ValueError('one valid Content-Length is required')
                size = int(length)
                limit = MAX_IMAGE_BYTES if is_image else MAX_JSON_BYTES
                if not 0 < size <= limit:
                    return self.respond(413, {'error': 'request size out of bounds'})
                content_type = self.one_header('Content-Type')
                expected_type = 'image/jpeg' if is_image else 'application/json'
                if content_type is None or content_type.split(';', 1)[0].strip().lower() != expected_type:
                    return self.respond(415, {'error': f'expected {expected_type}'})
                body = self.rfile.read(size)
                if len(body) != size:
                    raise ValueError('incomplete request body')
                if self.path == '/api/plan':
                    plan = default_ff680w_jpeg_scan_plan(**validate_settings(json.loads(body)))
                    self.respond(200, {'payload_hex': plan.to_payload().hex(), 'summary': plan.summary(),
                                       'host_features_not_implemented': HOST_FEATURES})
                elif self.path == '/api/jobs':
                    settings = json.loads(body)
                    if settings != {}:
                        raise ValueError('job request must be an empty JSON object')
                    job_id = datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '-' + secrets.token_hex(8)
                    path = output_root / job_id
                    path.mkdir(parents=True, exist_ok=False)
                    jobs[job_id] = path
                    self.respond(201, {'id': job_id, 'directory': str(path)})
                else:
                    directory, name = self.job_file('/api/jobs/')
                    if not body.startswith(b'\xff\xd8') or not body.endswith(b'\xff\xd9'):
                        raise ValueError('incomplete JPEG')
                    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                    temporary = '.upload-' + secrets.token_hex(16)
                    try:
                        file_fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=fd)
                        try:
                            with os.fdopen(file_fd, 'wb') as image:
                                image.write(body)
                            # Linking atomically publishes only the complete file and
                            # fails if the name exists, preserving prior scan output.
                            os.link(temporary, name, src_dir_fd=fd, dst_dir_fd=fd)
                        finally:
                            os.unlink(temporary, dir_fd=fd)
                    finally:
                        os.close(fd)
                    path = directory / name
                    self.respond(201, {'file': str(path), 'url': f'/images/{directory.name}/{name}', 'bytes': len(body)})
            except FileExistsError:
                self.respond(409, {'error': 'output already exists; original file preserved'})
            except (ValueError, TypeError, OSError) as exc:
                self.respond(400, {'error': str(exc)})

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--output-root', type=Path, default=Path('scans/browser-webusb'))
    args = parser.parse_args()
    server = create_server(args.output_root, args.port)
    print(f'Local WebUSB scanner UI: http://127.0.0.1:{server.server_address[1]}', flush=True)
    print(f'Output root: {args.output_root.resolve()}', flush=True)
    print('USB stays in the browser. No external scripts, uploads, or network scanner settings.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
