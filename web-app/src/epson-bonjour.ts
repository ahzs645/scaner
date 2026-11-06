import type {NetworkScannerTarget} from './desktop.js';

export const EPSON_SERVICE = '_scanner._tcp';
const SERVICE = EPSON_SERVICE + '.local';
const MAX_RECORDS = 128;
const MAX_SOURCES = 24;
const MAX_TARGETS = 8;
const decoder = new TextDecoder();

export function isPrivateIPv4(value: string): boolean {
  const octets = value.split('.');
  if (octets.length !== 4 || !octets.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)) return false;
  const [a, b] = octets.map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function scannerQuery(id: number): Uint8Array {
  const name = SERVICE.split('.').flatMap(label => [label.length, ...new TextEncoder().encode(label)]);
  return Uint8Array.of(id >> 8, id & 255, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...name, 0, 0, 12, 0, 1);
}

type Resource = {name: string; ttl: number} & (
  {type: 'PTR'; instance: string} | {type: 'SRV'; host: string; port: number}
  | {type: 'A'; address: string} | {type: 'TXT'; txt: Record<string, string>}
);
type Stored = Resource & {expires: number};

function records(packet: Uint8Array, id: number): Resource[] {
  if (packet.length < 12 || packet.length > 9000) return [];
  const bytes = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const get = (offset: number) => bytes.getUint16(offset);
  if (get(0) !== id || (get(2) & 0xfa0f) !== 0x8000) return [];
  const questionCount = get(4), recordCount = get(6) + get(8) + get(10);
  if (questionCount > 16 || recordCount > MAX_RECORDS) return [];

  function dnsName(start: number): {name: string; next: number} {
    const labels: string[] = [];
    let offset = start, next: number | undefined, length = 0;
    // A compression pointer may refer only to an earlier position.
    for (let hops = 0; hops < 128 && offset < packet.length; hops++) {
      const count = packet[offset++]!;
      if (count === 0) return {name: labels.join('.'), next: next ?? offset};
      if (count >>> 6 === 3) {
        const target = ((count & 63) << 8) | (packet[offset] ?? 0);
        if (offset >= packet.length || target >= offset - 1) break;
        next ??= offset + 1;
        offset = target;
        continue;
      }
      length += count + 1;
      if (count > 63 || length > 254 || offset + count > packet.length) break;
      const label = decoder.decode(packet.subarray(offset, offset + count));
      if (/[.\x00-\x1f\x7f\ufffd]/.test(label)) break;
      labels.push(label);
      offset += count;
    }
    throw Error('Invalid Bonjour name');
  }

  function txtRecord(offset: number, end: number): Record<string, string> {
    const txt: Record<string, string> = Object.create(null);
    while (offset < end) {
      const count = packet[offset++]!;
      if (offset + count > end) throw Error('Invalid Bonjour TXT length');
      const entry = decoder.decode(packet.subarray(offset, offset + count));
      offset += count;
      const separator = entry.indexOf('=');
      if (separator < 1) continue;
      const key = entry.slice(0, separator).toLowerCase();
      if (Object.hasOwn(txt, key)) throw Error('Duplicate Bonjour TXT key');
      txt[key] = entry.slice(separator + 1);
    }
    return txt;
  }

  const result: Resource[] = [];
  let offset = 12;
  for (let i = 0; i < questionCount; i++) offset = dnsName(offset).next + 4;
  for (let i = 0; i < recordCount; i++) {
    const owner = dnsName(offset);
    offset = owner.next;
    if (offset + 10 > packet.length) throw Error('Truncated Bonjour record');
    const type = get(offset), dnsClass = get(offset + 2) & 0x7fff, ttl = bytes.getUint32(offset + 4);
    const length = get(offset + 8);
    offset += 10;
    const end = offset + length;
    if (end > packet.length) throw Error('Truncated Bonjour payload');
    const base = {name: owner.name.toLowerCase(), ttl};
    if (dnsClass === 1 && type === 12 && length > 0) {
      const target = dnsName(offset);
      if (target.next !== end) throw Error('Invalid Bonjour PTR');
      result.push({...base, type: 'PTR', instance: target.name});
    } else if (dnsClass === 1 && type === 33 && length >= 7) {
      const host = dnsName(offset + 6);
      if (host.next !== end) throw Error('Invalid Bonjour SRV');
      result.push({...base, type: 'SRV', host: host.name, port: get(offset + 4)});
    } else if (dnsClass === 1 && type === 16) {
      result.push({...base, type: 'TXT', txt: txtRecord(offset, end)});
    } else if (dnsClass === 1 && type === 1 && length === 4) {
      result.push({...base, type: 'A', address: packet.subarray(offset, end).join('.')});
    }
    offset = end;
  }
  return result;
}

export interface DiscoveredEpson {
  target: NetworkScannerTarget;
  address: string;
}

/** Keep DNS-SD records from each responder together. The address record must
 * corroborate the reply's private source address before it can be selected. */
export class EpsonBrowse {
  private readonly sources = new Map<string, Map<string, Stored>>();
  constructor(private id: number) {}

  accept(packet: Uint8Array, address: string, port: number, now = Date.now()): void {
    if (port !== 5353 || !isPrivateIPv4(address)) return;
    let reply: Resource[];
    try { reply = records(packet, this.id); }
    catch { return; }
    if (!reply.length) return;
    let stored = this.sources.get(address);
    if (!stored) {
      if (this.sources.size >= MAX_SOURCES) return;
      stored = new Map();
      this.sources.set(address, stored);
    }
    for (const record of reply) {
      const suffix = record.type === 'PTR' ? ':' + record.instance.toLowerCase() : record.type === 'A' ? ':' + record.address : '';
      const key = record.type + ':' + record.name + suffix;
      if (!record.ttl) stored.delete(key);
      else if (stored.has(key) || stored.size < MAX_RECORDS) stored.set(key, {...record, expires: now + record.ttl * 1000});
    }
  }

  targets(now = Date.now()): DiscoveredEpson[] {
    const found = new Map<string, DiscoveredEpson>();
    for (const [address, stored] of this.sources) {
      const current = [...stored.values()].filter(record => record.expires > now);
      for (const ptr of current) {
        if (ptr.type !== 'PTR' || ptr.name !== SERVICE || !ptr.instance.toLowerCase().endsWith('.' + SERVICE)) continue;
        const label = ptr.instance.slice(0, -SERVICE.length - 1), key = ptr.instance.toLowerCase();
        if (!label) continue;
        const srv = current.find(record => record.type === 'SRV' && record.name === key);
        const txt = current.find(record => record.type === 'TXT' && record.name === key);
        if (srv?.type !== 'SRV' || srv.port !== 1865 || txt?.type !== 'TXT') continue;
        if (txt.txt.mdl !== 'FF-680W' || txt.txt.mfg !== 'EPSON') continue;
        const host = srv.host.toLowerCase();
        if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+local$/.test(host)) continue;
        if (!current.some(record => record.type === 'A' && record.name === host && record.address === address)) continue;
        const id = 'iwa:epson-ff680w:' + address;
        const available = txt.txt.scanneravailable === '1' ? true : txt.txt.scanneravailable === '0' ? false : undefined;
        found.set(id, {address, target: {id, label, model: 'FF-680W', host: srv.host, port: 1865,
          serviceType: EPSON_SERVICE, protocol: 'epson-esci2-tcp', available}});
        if (found.size >= MAX_TARGETS) return [...found.values()];
      }
    }
    return [...found.values()];
  }
}
