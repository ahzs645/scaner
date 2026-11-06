import {execFile} from 'node:child_process';
import {copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';

const signingKey = process.argv[2];
if (!signingKey || process.argv.length !== 3) {
  throw Error('Usage: npm run package:iwa -- /path/to/ed25519-signing-key.pem');
}
const run = promisify(execFile);
const {version} = JSON.parse(await readFile('package.json', 'utf8'));
const output = resolve('iwa-output', 'Scan-Studio.swbn');
const staging = await mkdtemp(join(tmpdir(), 'scan-studio-iwa-'));
try {
  const assets = join(staging, 'assets');
  const unsigned = join(staging, 'scan-studio.wbn');
  const signed = join(staging, 'Scan-Studio.swbn');
  await cp('dist', assets, {recursive: true});
  await mkdir(join(assets, '.well-known'), {recursive: true});
  await copyFile('iwa/icon.svg', join(assets, 'scan-studio-icon.svg'));
  await copyFile('iwa/ocr-worker.js', join(assets, 'vendor', 'ocr', 'iwa-worker.js'));
  await writeFile(join(assets, '.well-known', 'manifest.webmanifest'), JSON.stringify({
    id: '/',
    name: 'Scan Studio',
    short_name: 'Scan Studio',
    version,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    icons: [{src: '/scan-studio-icon.svg', sizes: '192x192', type: 'image/svg+xml'}],
    permissions_policy: Object.fromEntries(
      ['cross-origin-isolated', 'direct-sockets', 'direct-sockets-multicast', 'local-network', 'loopback-network']
        .map(permission => [permission, ['self']]),
    ),
  }, null, 2) + '\n');
  await run(resolve('node_modules', '.bin', 'wbn'), ['--dir', assets, '--output', unsigned]);
  const {stdout} = await run(resolve('node_modules', '.bin', 'wbn-sign'), ['sign', unsigned, resolve(signingKey), '--output', signed]);
  await mkdir(resolve('iwa-output'), {recursive: true});
  await copyFile(signed, output);
  console.log(stdout.trim());
  console.log('Signed Chrome app: ' + output);
} finally {
  await rm(staging, {recursive: true, force: true});
}
