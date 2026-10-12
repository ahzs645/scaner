import {spawn} from 'node:child_process';
import {isIP} from 'node:net';

export const SERVICE_TYPE = '_scanner._tcp';
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const MAX_TARGETS = 8;
const MAX_TIMEOUT_MS = 10_000;
const MODEL = 'FF-680W';
const PROTOCOL = 'epson-esci2-tcp';

function boundedOutput(output) {
  if (typeof output !== 'string') throw new TypeError('Bonjour output must be text');
  if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) throw new RangeError('Bonjour output exceeds 64 KiB');
  return output;
}
function timeoutValue(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError('Discovery timeout must be an integer between 10 and 10000 ms');
  }
  return timeoutMs;
}
function instanceName(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 255
    && !/[\x00-\x1f\x7f]/.test(value);
}
function decodeDnsEscapes(value) {
  return value.replace(/\\(\d{3}|.)/g, (_, escaped) => /^\d{3}$/.test(escaped)
    ? String.fromCharCode(Number(escaped)) : escaped);
}
function validLocalHost(value) {
  if (typeof value !== 'string') return false;
  const host = value.toLowerCase().replace(/\.$/, '');
  return host.length <= 253 && host.endsWith('.local') && host.split('.').every(label =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}
function privateIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Only service advertisements are parsed: no address range is scanned. Rmv
 * retires a prior Add, including the usual repeated interface announcements. */
export function parseBrowseOutput(output) {
  const active = new Map();
  for (const line of boundedOutput(output).split(/\r?\n/)) {
    const match = /^\s*\S+\s+(Add|Rmv)\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, action, domain, type, name] = match;
    if (domain.toLowerCase() !== 'local.' || type.replace(/\.$/, '') !== SERVICE_TYPE || !instanceName(name)) continue;
    const key = name.toLowerCase();
    const networkInterface = line.trim().split(/\s+/)[3];
    const previous = active.get(key);
    if (action === 'Rmv' && previous) {
      previous.interfaces.delete(networkInterface);
      if (!previous.interfaces.size) active.delete(key);
    } else if (action === 'Add' && (previous || active.size < MAX_TARGETS)) {
      const entry = previous ?? {advertisement: Object.freeze({instanceName: name, serviceType: SERVICE_TYPE, domain: 'local.'}), interfaces: new Set()};
      entry.interfaces.add(networkInterface); active.set(key, entry);
    }
  }
  return [...active.values()].map(entry => entry.advertisement);
}

/** dns-sd renders TXT values with escaped spaces or quotes. Duplicate keys
 * are rejected rather than allowing later text to change model identity. */
export function parseTxtRecords(output) {
  boundedOutput(output);
  const words = [];
  let word = '', quoted = false, escaped = false;
  for (const character of output) {
    if (escaped) {word += character; escaped = false;}
    else if (character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (/\s/.test(character) && !quoted) {if (word) words.push(word); word = '';}
    else word += character;
  }
  if (quoted || escaped) return null;
  if (word) words.push(word);
  const records = Object.create(null);
  for (const entry of words) {
    const equals = entry.indexOf('=');
    if (equals < 1) continue;
    const key = entry.slice(0, equals), value = entry.slice(equals + 1);
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || /[\x00-\x1f\x7f]/.test(value)) return null;
    if (Object.hasOwn(records, key)) return null;
    records[key] = value;
  }
  return records;
}

/** FF network endpoints remain distinct from USB vendor/product identities.
 * Discovery accepts a local DNS name and the known Epson scan service port. */
export function validateNetworkTarget(target) {
  if (!target || target.model !== MODEL || target.serviceType !== SERVICE_TYPE || target.protocol !== PROTOCOL
    || target.port !== 1865 || !instanceName(target.label) || typeof target.host !== 'string') {
    throw new TypeError('Unsupported FF-680W network target');
  }
  const host = target.host.replace(/\.$/, '');
  if (!validLocalHost(host)) {
    throw new TypeError('Bonjour target must be a valid local DNS hostname');
  }
  if (target.available !== undefined && typeof target.available !== 'boolean') throw new TypeError('Invalid scanner availability');
  return Object.freeze({id: `network:epson-ff680w:${host.toLowerCase()}:1865`, label: target.label, model: MODEL,
    host, port: 1865, serviceType: SERVICE_TYPE, protocol: PROTOCOL, available: target.available});
}

/** Parse only A records for the selected advertised host. Public, loopback,
 * IPv6, unrelated-host and removed records never become connection targets.
 * RFC1918 and IPv4 link-local addresses are accepted; no subnet is searched. */
export function parseAddressOutput(output, target) {
  boundedOutput(output);
  const selected = validateNetworkTarget(target), expected = selected.host.toLowerCase();
  const active = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*\S+\s+(Add|Rmv)\s+\d+\s+(\d+)\s+(\S+)\s+(\S+)\s+\d+\s*$/.exec(line);
    if (!match) continue;
    const [, action, networkInterface, hostname, address] = match;
    if (decodeDnsEscapes(hostname).replace(/\.$/, '').toLowerCase() !== expected || !privateIPv4(address)) continue;
    const interfaces = active.get(address);
    if (action === 'Rmv' && interfaces) {
      interfaces.delete(networkInterface);
      if (!interfaces.size) active.delete(address);
    } else if (action === 'Add' && (interfaces || active.size < MAX_TARGETS)) {
      const present = interfaces ?? new Set(); present.add(networkInterface); active.set(address, present);
    }
  }
  const address = active.keys().next().value;
  return address ? Object.freeze({address, family: 4}) : null;
}

export function parseResolveOutput(output, advertisement) {
  boundedOutput(output);
  if (!advertisement || !instanceName(advertisement.instanceName) || advertisement.serviceType !== SERVICE_TYPE
    || advertisement.domain !== 'local.') return null;
  let endpoint, txtLines = [];
  const expected = `${advertisement.instanceName}.${SERVICE_TYPE}.local.`.toLowerCase();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*\S+\s+(.+?) can be reached at (\S+):(\d+) \(interface \d+\)\s*$/.exec(line);
    if (match) {
      // A new record supersedes its preceding TXT, even if it is invalid.
      endpoint = undefined; txtLines = [];
      if (decodeDnsEscapes(match[1]).toLowerCase() === expected) endpoint = {host: match[2], port: Number(match[3])};
    } else if (endpoint && /^\s+\S/.test(line)) txtLines.push(line.trim());
  }
  if (!endpoint) return null;
  const txt = parseTxtRecords(txtLines.join(' '));
  if (!txt || (txt.mdl !== undefined ? txt.mdl !== MODEL : txt.ty !== 'EPSON FF-680W')) return null;
  if ((txt.mfg !== undefined && txt.mfg !== 'EPSON') || (txt.ty !== undefined && txt.ty !== 'EPSON FF-680W')) return null;
  const available = txt.scannerAvailable === '1' ? true : txt.scannerAvailable === '0' ? false : undefined;
  try {return validateNetworkTarget({...endpoint, label: advertisement.instanceName, model: MODEL,
    serviceType: SERVICE_TYPE, protocol: PROTOCOL, available});} catch {return null;}
}

/** Injection seam for tests; production invokes one fixed executable without
 * a shell. dns-sd is a long-running watcher, so timeout returns captured data
 * after termination. Output overflow and startup errors reject. */
export function createDnsSdRunner({spawnProcess = spawn, platform = process.platform} = {}) {
  return (args, {timeoutMs}) => {
    timeoutValue(timeoutMs);
    if (platform !== 'darwin') return Promise.reject(Error('LAN Bonjour discovery currently requires macOS'));
    const valid = Array.isArray(args) && (args.length === 3 && args[0] === '-B' && args[1] === SERVICE_TYPE && args[2] === 'local.'
      || args.length === 4 && args[0] === '-L' && instanceName(args[1]) && args[2] === SERVICE_TYPE && args[3] === 'local.'
      || args.length === 3 && args[0] === '-G' && args[1] === 'v4' && validLocalHost(args[2]));
    if (!valid) return Promise.reject(Error('Unsupported Bonjour command'));
    return new Promise((resolve, reject) => {
      let child;
      try {child = spawnProcess('/usr/bin/dns-sd', args, {stdio: ['ignore', 'pipe', 'pipe'], shell: false});}
      catch (error) {reject(error); return;}
      let bytes = 0, chunks = [], settled = false, stopping = false, failure;
      let deadline, hardKill, completion;
      const settle = () => {
        if (settled) return; settled = true;
        clearTimeout(deadline); clearTimeout(hardKill); clearTimeout(completion);
        child.stdout?.off('data', receive); child.stderr?.off('data', receive);
        child.off('error', onError); child.off('close', onClose);
        // Any late startup error must not become an unhandled EventEmitter error.
        child.on('error', () => {});
        if (failure) reject(failure); else resolve(Buffer.concat(chunks).toString('utf8'));
        chunks = [];
      };
      const kill = signal => {try {child.kill(signal);} catch (error) {failure ??= error;}};
      const stop = error => {
        if (settled || stopping) return; stopping = true; failure = error;
        kill('SIGTERM');
        if (settled) return;
        hardKill = setTimeout(() => kill('SIGKILL'), 250);
        // Bound even a mocked/broken process which never emits close after kill.
        completion = setTimeout(settle, 500);
      };
      const receive = data => {
        if (settled || stopping) return;
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (bytes + chunk.length > MAX_OUTPUT_BYTES) {stop(Error('Bonjour output exceeds 64 KiB')); return;}
        bytes += chunk.length; chunks.push(chunk);
      };
      const onError = error => stop(error);
      const onClose = code => {if (!stopping && code !== 0) failure = Error(`Bonjour process exited with code ${code}`); settle();};
      child.stdout?.on('data', receive); child.stderr?.on('data', receive);
      child.on('error', onError); child.on('close', onClose);
      deadline = setTimeout(() => stop(), timeoutMs);
    });
  };
}

const defaultRunner = createDnsSdRunner();
/** Resolve a main-process registry target through Bonjour, avoiding an
 * unbounded system getaddrinfo lookup. Never accept a renderer-provided host
 * instead of the selected registry target. Cleanup may add at most 500 ms. */
export async function resolveNetworkAddress(target, {timeoutMs = 2000, runner = defaultRunner} = {}) {
  timeoutValue(timeoutMs);
  if (typeof runner !== 'function') throw new TypeError('Discovery runner must be a function');
  const selected = validateNetworkTarget(target);
  const output = await runner(['-G', 'v4', selected.host], {timeoutMs});
  const address = parseAddressOutput(output, selected);
  if (!address) throw Error('Bonjour did not resolve the selected scanner to a private LAN IPv4 address within the discovery window');
  return address;
}
/** timeoutMs bounds the discovery budget: half for browsing, then at most eight
 * parallel resolves with the remaining budget. Process cleanup can add 500 ms.
 * An injected runner is responsible for honoring its per-command timeout. */
export async function discoverNetworkScanners({timeoutMs = 2000, runner = defaultRunner} = {}) {
  timeoutValue(timeoutMs);
  if (typeof runner !== 'function') throw new TypeError('Discovery runner must be a function');
  const started = Date.now(), browseMs = Math.max(10, Math.floor(timeoutMs / 2));
  const advertisements = parseBrowseOutput(await runner(['-B', SERVICE_TYPE, 'local.'], {timeoutMs: browseMs}));
  const remaining = timeoutMs - (Date.now() - started);
  if (remaining < 10 || !advertisements.length) return [];
  const results = await Promise.allSettled(advertisements.map(async advertisement => parseResolveOutput(
    await runner(['-L', advertisement.instanceName, SERVICE_TYPE, 'local.'], {timeoutMs: remaining}), advertisement)));
  const targets = new Map();
  for (const result of results) if (result.status === 'fulfilled' && result.value) targets.set(result.value.id, result.value);
  return [...targets.values()].slice(0, MAX_TARGETS);
}
