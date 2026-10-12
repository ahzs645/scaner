import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDnsSdRunner, discoverNetworkScanners, parseBrowseOutput, parseResolveOutput,
  parseTxtRecords, validateNetworkTarget, parseAddressOutput, resolveNetworkAddress, MAX_OUTPUT_BYTES, MAX_TARGETS} from '../discovery.mjs';

const name = 'EPSON FF-680W';
const advertisement = Object.freeze({instanceName: name, serviceType: '_scanner._tcp', domain: 'local.'});
const browse = (instance = name, action = 'Add', networkInterface = 14) =>
  `14:07:19.937 ${action} 2 ${networkInterface} local. _scanner._tcp. ${instance}\n`;
const resolve = (txt = 'mfg=EPSON mdl=FF-680W ty=EPSON\\ FF-680W scannerAvailable=1', host = 'EPSONFB2F50.local.', port = 1865, instance = name) =>
  `Lookup ${instance}._scanner._tcp.local.\n14:10:37.389 ${instance.replaceAll(' ', '\\032')}._scanner._tcp.local. can be reached at ${host}:${port} (interface 14)\n ${txt}\n`;

test('browse tracks multiple interfaces, removal, duplicate records and fixed service scope', () => {
  const output = 'Timestamp A/R Flags if Domain Service Type Instance Name\n' + browse() + browse(name, 'Add', 15)
    + browse(name, 'Rmv', 14) + browse('Removed') + browse('Removed', 'Rmv')
    + '14:00:00 Add 2 3 local. _uscan._tcp. Other\n'
    + '14:00:00 Add 2 3 example.com. _scanner._tcp. Other\n';
  assert.deepEqual(parseBrowseOutput(output), [advertisement]);
  assert.deepEqual(parseBrowseOutput(output + browse(name, 'Rmv', 15)), []);
});

test('browse caps independent targets and rejects oversized UTF-8 output', () => {
  assert.equal(parseBrowseOutput(Array.from({length: 20}, (_, i) => browse(`Office ${i}`)).join('')).length, MAX_TARGETS);
  assert.throws(() => parseBrowseOutput('é'.repeat(MAX_OUTPUT_BYTES / 2 + 1)), /64 KiB/);
  assert.throws(() => parseBrowseOutput(null), /text/);
});

test('TXT parser handles escaped spaces and quoted fields, rejecting conflicting keys', () => {
  const txt = parseTxtRecords('ty=EPSON\\ FF-680W note="Front desk" mdl=FF-680W');
  assert.equal(txt.ty, name); assert.equal(txt.note, 'Front desk');
  for (const text of ['mdl=FF-680W mdl=Other', 'note="unfinished', 'note=unfinished\\', 'mdl=FF-680W\u0000']) {
    assert.equal(parseTxtRecords(text), null);
  }
});

test('resolve creates immutable network identities only from exact FF TXT metadata', () => {
  const target = parseResolveOutput(resolve(), advertisement);
  assert.deepEqual(target, {id: 'network:epson-ff680w:epsonfb2f50.local:1865', label: name,
    model: 'FF-680W', host: 'EPSONFB2F50.local', port: 1865, serviceType: '_scanner._tcp',
    protocol: 'epson-esci2-tcp', available: true});
  assert.equal(Object.isFrozen(target), true);
  assert.equal('vendorId' in target, false); assert.equal('productId' in target, false);
  assert.throws(() => {target.host = 'attacker.local';}, TypeError);
  assert.equal(parseResolveOutput(resolve('ty="EPSON FF-680W" scannerAvailable=0'), advertisement).available, false);
  assert.equal(parseResolveOutput(resolve('mdl=FF-680W scannerAvailable=unknown'), advertisement).available, undefined);
});

test('resolve does not trust instance names, other models, origins, URLs or ports', () => {
  for (const text of ['mdl=Other ty=EPSON\\ FF-680W', 'ty=Other', 'mdl=FF-680W mfg=OTHER',
    'mdl=FF-680W ty=Other', 'mdl=FF-680W mdl=FF-680W', 'note=FF-680W']) {
    assert.equal(parseResolveOutput(resolve(text), advertisement), null);
  }
  for (const host of ['example.com', '127.0.0.1', '-bad.local', 'bad-.local', 'x'.repeat(64) + '.local', 'https://scanner.local', 'scanner..local']) {
    assert.equal(parseResolveOutput(resolve(undefined, host), advertisement), null);
  }
  for (const port of [0, 80, 443, 65536]) assert.equal(parseResolveOutput(resolve(undefined, undefined, port), advertisement), null);
  assert.equal(parseResolveOutput(resolve(undefined, undefined, undefined, 'Another'), advertisement), null);
  assert.equal(parseResolveOutput(resolve(), {...advertisement, serviceType: '_uscan._tcp'}), null);
  assert.equal(parseResolveOutput(resolve('mdl=FF-680W') + resolve('mdl=Other'), advertisement), null);
});

test('target validation returns a snapshot without mutating the supplied object', () => {
  const input = {label: name, host: 'SCANNER.local.', port: 1865, model: 'FF-680W', protocol: 'epson-esci2-tcp', serviceType: '_scanner._tcp'};
  const snapshot = structuredClone(input), result = validateNetworkTarget(input);
  assert.deepEqual(input, snapshot); input.host = 'other.local'; assert.equal(result.host, 'SCANNER.local');
  assert.throws(() => validateNetworkTarget({...input, available: '1'}), /availability/);
});

test('discovery only browses and resolves bounded advertised names, with no network job commands', async () => {
  const calls = [];
  const runner = async (args, {timeoutMs}) => {
    calls.push({args, timeoutMs});
    return args[0] === '-B' ? browse() + browse('Other Model') + browse('Duplicate') + browse('Broken')
      : args[1] === 'Broken' ? Promise.reject(Error('Unable to resolve'))
      : args[1] === 'Other Model' ? resolve('mdl=Other', undefined, undefined, args[1])
      : resolve(undefined, undefined, undefined, args[1]);
  };
  const targets = await discoverNetworkScanners({timeoutMs: 2000, runner});
  assert.equal(targets.length, 1); assert.equal(targets[0].available, true);
  assert.equal(calls.length, 5); assert.deepEqual(calls[0].args, ['-B', '_scanner._tcp', 'local.']);
  assert.equal(calls[0].timeoutMs, 1000);
  assert.ok(calls.every(call => call.timeoutMs > 0 && call.timeoutMs <= 2000));
  assert.ok(calls.slice(1).every(call => call.args[0] === '-L' && call.args[2] === '_scanner._tcp'));
});

test('discovery validates caller budget and caps resolve count', async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 10001, 10.5]) {
    await assert.rejects(discoverNetworkScanners({timeoutMs, runner: async () => ''}), /timeout/);
  }
  let resolves = 0;
  await discoverNetworkScanners({runner: async args => {
    if (args[0] === '-B') return Array.from({length: 50}, (_, i) => browse(`Office ${i}`)).join('');
    resolves++; return '';
  }});
  assert.equal(resolves, MAX_TARGETS);
});

function fakeProcess({closeOnKill = true} = {}) {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kills = [];
  child.kill = signal => {child.kills.push(signal); if (closeOnKill) queueMicrotask(() => child.emit('close', null, signal)); return true;};
  return child;
}

test('production runner uses fixed dns-sd executable without a shell and terminates timeout watchers', async () => {
  const child = fakeProcess(); let invocation;
  const runner = createDnsSdRunner({platform: 'darwin', spawnProcess: (...args) => {
    invocation = args; queueMicrotask(() => child.stdout.emit('data', Buffer.from(browse()))); return child;
  }});
  assert.equal(await runner(['-B', '_scanner._tcp', 'local.'], {timeoutMs: 10}), browse());
  assert.equal(invocation[0], '/usr/bin/dns-sd'); assert.equal(invocation[2].shell, false);
  assert.deepEqual(child.kills, ['SIGTERM']);
});

test('runner bounds combined output and cleans up process startup errors', async () => {
  for (const mode of ['overflow', 'error']) {
    const child = fakeProcess();
    const runner = createDnsSdRunner({platform: 'darwin', spawnProcess: () => {
      queueMicrotask(() => {
        if (mode === 'error') child.emit('error', Error('spawn failed'));
        else {child.stdout.emit('data', Buffer.alloc(MAX_OUTPUT_BYTES)); child.stderr.emit('data', Buffer.from('x'));}
      }); return child;
    }});
    await assert.rejects(runner(['-B', '_scanner._tcp', 'local.'], {timeoutMs: 1000}), mode === 'error' ? /spawn failed/ : /64 KiB/);
    assert.deepEqual(child.kills, ['SIGTERM']);
  }
});

test('runner escalates a stuck process and bounds completion even without close', async () => {
  const child = fakeProcess({closeOnKill: false});
  const runner = createDnsSdRunner({platform: 'darwin', spawnProcess: () => child});
  assert.equal(await runner(['-B', '_scanner._tcp', 'local.'], {timeoutMs: 10}), '');
  assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL']);
});

test('runner handles ordinary close and refuses unsupported platforms/commands before spawn', async () => {
  const child = fakeProcess(); let spawned = 0;
  const spawnProcess = () => {spawned++; queueMicrotask(() => {child.stdout.emit('data', Buffer.from('done')); child.emit('close', 0);}); return child;};
  const runner = createDnsSdRunner({platform: 'darwin', spawnProcess});
  assert.equal(await runner(['-B', '_scanner._tcp', 'local.'], {timeoutMs: 1000}), 'done');
  assert.deepEqual(child.kills, []);
  await assert.rejects(runner(['-B', '_uscan._tcp', 'local.'], {timeoutMs: 1000}), /Unsupported/);
  await assert.rejects(createDnsSdRunner({platform: 'linux', spawnProcess})(['-B', '_scanner._tcp', 'local.'], {timeoutMs: 1000}), /macOS/);
  assert.equal(spawned, 1);
});

const addressLine = (address = '192.168.1.73', hostname = 'EPSONFB2F50.local.', action = 'Add', networkInterface = 14) =>
  `17:11:28.604 ${action} 2 ${networkInterface} ${hostname} ${address} 120\n`;
const selectedTarget = () => parseResolveOutput(resolve(), advertisement);

test('address records are pinned to the selected host with case-insensitive comparison', () => {
  const target = selectedTarget(), original = structuredClone(target);
  assert.deepEqual(parseAddressOutput(addressLine(undefined, 'epsonfb2f50.LOCAL.'), target), {address: '192.168.1.73', family: 4});
  assert.equal(parseAddressOutput(addressLine(undefined, 'other.local.'), target), null);
  assert.deepEqual(target, original);
  assert.equal(Object.isFrozen(parseAddressOutput(addressLine(), target)), true);
});

test('address parser permits private LAN IPv4 only, including link-local', () => {
  for (const address of ['10.1.2.3', '172.16.0.5', '172.31.255.254', '192.168.1.73', '169.254.20.2']) {
    assert.deepEqual(parseAddressOutput(addressLine(address), selectedTarget()), {address, family: 4});
  }
  for (const address of ['172.15.0.1', '172.32.0.1', '192.169.0.1', '8.8.8.8', '127.0.0.1', '0.0.0.0',
    '224.0.0.251', '255.255.255.255', '192.168.1.999', '192.168.001.2', '::1', 'fe80::1234']) {
    assert.equal(parseAddressOutput(addressLine(address), selectedTarget()), null, address);
  }
  assert.throws(() => parseAddressOutput('x'.repeat(MAX_OUTPUT_BYTES + 1), selectedTarget()), /64 KiB/);
});

test('address removal and interface repeats leave only a currently advertised A record', () => {
  const target = selectedTarget();
  const records = addressLine() + addressLine(undefined, undefined, 'Add', 15) + addressLine(undefined, undefined, 'Rmv', 14);
  assert.deepEqual(parseAddressOutput(records, target), {address: '192.168.1.73', family: 4});
  assert.equal(parseAddressOutput(records + addressLine(undefined, undefined, 'Rmv', 15), target), null);
  assert.equal(parseAddressOutput('Timestamp A/R Flags if Hostname Address TTL\n', target), null);
});

test('address resolution preserves advertised casing and does not mutate selected metadata', async () => {
  const target = selectedTarget(), original = structuredClone(target); let invocation;
  const result = await resolveNetworkAddress(target, {timeoutMs: 1234, runner: async (...args) => {
    invocation = args; return addressLine();
  }});
  assert.deepEqual(invocation, [['-G', 'v4', 'EPSONFB2F50.local'], {timeoutMs: 1234}]);
  assert.deepEqual(result, {address: '192.168.1.73', family: 4}); assert.deepEqual(target, original);
  assert.equal(validateNetworkTarget({...target, host: target.host.toLowerCase()}).id, target.id);
});

test('address resolution rejects unsupported target or absent/private-invalid A answers', async () => {
  let called = false;
  await assert.rejects(resolveNetworkAddress({...selectedTarget(), host: 'example.com'}, {runner: async () => {called = true; return '';}}), /local DNS/);
  assert.equal(called, false);
  for (const output of ['', addressLine('8.8.8.8'), addressLine(undefined, 'unrelated.local.')]) {
    await assert.rejects(resolveNetworkAddress(selectedTarget(), {runner: async () => output}), /private LAN IPv4/);
  }
  await assert.rejects(resolveNetworkAddress(selectedTarget(), {timeoutMs: Infinity}), /timeout/);
});

test('fixed process runner allows only v4 local-host lookup and terminates it on timeout', async () => {
  let spawned = 0; const child = fakeProcess();
  const runner = createDnsSdRunner({platform: 'darwin', spawnProcess: (path, args) => {
    spawned++; assert.equal(path, '/usr/bin/dns-sd'); assert.deepEqual(args, ['-G', 'v4', 'EPSONFB2F50.local']);
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(addressLine()))); return child;
  }});
  const output = await runner(['-G', 'v4', 'EPSONFB2F50.local'], {timeoutMs: 10});
  assert.equal(output, addressLine()); assert.deepEqual(child.kills, ['SIGTERM']);
  for (const args of [['-G', 'v6', 'scanner.local'], ['-G', 'v4', 'example.com'], ['-G', 'v4', '--help'],
    ['-G', 'v4', '192.168.1.73'], ['-G', 'v4', 'scanner.local', '--extra']]) {
    await assert.rejects(runner(args, {timeoutMs: 1000}), /Unsupported/);
  }
  assert.equal(spawned, 1);
});
