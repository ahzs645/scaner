import type {NetworkBridge, NetworkScannerTarget} from './desktop.js';
import {EpsonBrowse, EPSON_SERVICE, isPrivateIPv4, scannerQuery} from './epson-bonjour.js';
import type {DiscoveredEpson} from './epson-bonjour.js';
import {EpsonSession, readEpsonSettings, scanEpsonNetwork} from './epson-network.js';
import type {EpsonConnectionOptions, EpsonSocket} from './epson-network.js';

type DirectSocket<OpenInfo> = {
  opened: Promise<OpenInfo>;
  closed: Promise<unknown>;
  close(): Promise<unknown>;
};
interface TcpStreams {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  remoteAddress: string;
  remotePort: number;
}
interface Datagram {
  data: Uint8Array;
  remoteAddress: string;
  remotePort: number;
}
interface UdpStreams {
  readable: ReadableStream<Datagram>;
  writable: WritableStream<Datagram>;
}
type Tcp = new (host: string, port: number, options?: {noDelay: boolean}) => DirectSocket<TcpStreams>;
type Udp = new (options: {localAddress: string; multicastTimeToLive: number}) => DirectSocket<UdpStreams>;
type SocketGlobals = typeof globalThis & {TCPSocket?: Tcp; UDPSocket?: Udp};
const SELECTION_LIFETIME = 5 * 60 * 1000;
const DISCOVERY_MS = 2500;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function withTimeout<T>(promise: Promise<T>, duration: number, error: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(error)), duration); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function networkError(error: unknown, discovery = false): Error {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'InvalidAccessError')) {
    const access = discovery ? 'local network and loopback access' : 'local network access';
    return Error('Allow ' + access + ' for Scan Studio in Chrome, then try again.', {cause: error});
  }
  return error instanceof Error ? error : Error(String(error));
}

export function openDirectTcp(TCPSocket: Tcp, address: string, port: number): EpsonSocket {
  if (!isPrivateIPv4(address) || port !== 1865) throw Error('Choose a private IPv4 Epson scanner on port 1865');
  const socket = new TCPSocket(address, port, {noDelay: true});
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let closed = false, destroyed = false;
  void socket.closed.then(() => { closed = true; }, () => { closed = true; });
  const opened = socket.opened.then(streams => {
    if (destroyed) return;
    if (streams.remoteAddress !== address || streams.remotePort !== port) throw Error('Chrome connected to an unexpected scanner address');
    reader = streams.readable.getReader();
    writer = streams.writable.getWriter();
    // Stream errors are observed by read()/write(), and can occur between calls.
    void reader.closed.catch(() => {});
    void writer.closed.catch(() => {});
  }, error => { throw networkError(error); });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    reader?.releaseLock();
    writer?.releaseLock();
    void socket.close().catch(() => {});
  };
  return {
    opened,
    get closed() { return closed || destroyed; },
    async read() {
      const next = await reader!.read();
      return next.done ? undefined : next.value;
    },
    write: bytes => writer!.write(bytes),
    async close() {
      // All application writes, including Epson unlock, have already resolved.
      try { if (!closed) await writer?.close(); }
      finally { destroy(); }
    },
    destroy,
  };
}

async function browse(UdpSocket: Udp, localAddress: string): Promise<DiscoveredEpson[]> {
  let socket: DirectSocket<UdpStreams> | undefined;
  let reader: ReadableStreamDefaultReader<Datagram> | undefined;
  let writer: WritableStreamDefaultWriter<Datagram> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    socket = new UdpSocket({localAddress, multicastTimeToLive: 255});
    void socket.closed.catch(() => {});
    const {readable, writable} = await withTimeout(socket.opened, 30000, 'Local network permission or Wi-Fi binding timed out');
    reader = readable.getReader();
    writer = writable.getWriter();
    void reader.closed.catch(() => {});
    void writer.closed.catch(() => {});
    const [id] = crypto.getRandomValues(new Uint16Array(1));
    const discovery = new EpsonBrowse(id!);
    const request = {data: scannerQuery(id!), remoteAddress: '224.0.0.251', remotePort: 5353};
    await withTimeout(writer.write(request), 3000, 'Bonjour query timed out');
    const timeout = new Promise<null>(resolve => { timer = setTimeout(resolve, DISCOVERY_MS, null); });
    for (;;) {
      const next = await Promise.race([reader.read(), timeout]);
      if (!next || next.done) return discovery.targets();
      const {data, remoteAddress, remotePort} = next.value;
      discovery.accept(data, remoteAddress, remotePort);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NetworkError' && localAddress !== '0.0.0.0') {
      throw Error('Could not use that Wi-Fi address. Check the Mac’s current IPv4 address in System Settings.', {cause: error});
    }
    throw networkError(error, true);
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
    writer?.releaseLock();
    if (socket) void socket.close().catch(() => {});
  }
}

export interface IwaNetworkBridge extends NetworkBridge {
  useScannerAddress(address: string): NetworkScannerTarget;
}

export function createIwaNetworkBridge(): IwaNetworkBridge | undefined {
  const {TCPSocket, UDPSocket} = globalThis as SocketGlobals;
  if (location.protocol !== 'isolated-app:' || !crossOriginIsolated || !TCPSocket || !UDPSocket) return;
  const discovered = new Map<string, DiscoveredEpson & {expires: number}>();
  let active = false;
  let scan: {token: string; controller: AbortController} | undefined;
  const createSession = (options: EpsonConnectionOptions) =>
    new EpsonSession((host, port) => openDirectTcp(TCPSocket, host, port), options);

  function selected(id: string): EpsonConnectionOptions {
    const entry = discovered.get(id);
    if (!entry || entry.expires <= Date.now()) throw Error('Find and choose a scanner again, or enter its address in Network options.');
    return {host: entry.address, port: entry.target.port};
  }

  async function exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (active) throw Error('A network scanner operation is already running');
    active = true;
    try {
      return await navigator.locks.request('scan-studio-iwa-epson', {ifAvailable: true}, async lock => {
        if (!lock) throw Error('The network scanner is in use in another Scan Studio window');
        return action();
      });
    } finally { active = false; }
  }

  return {
    async discoverNetwork(address) {
      const localAddress = address?.trim();
      if (localAddress && !isPrivateIPv4(localAddress)) throw Error('Enter the Mac’s private Wi-Fi IPv4 address, or leave it blank.');
      discovered.clear();
      const results = await browse(UDPSocket, localAddress || '0.0.0.0');
      const expires = Date.now() + SELECTION_LIFETIME;
      for (const entry of results) discovered.set(entry.target.id, {...entry, expires});
      return results.map(entry => entry.target);
    },
    useScannerAddress(address) {
      address = address.trim();
      if (!isPrivateIPv4(address)) throw Error('Enter the scanner’s private IPv4 address.');
      const target: NetworkScannerTarget = {id: 'iwa:epson-ff680w:' + address, label: 'Scanner at ' + address,
        model: 'FF-680W', host: address, port: 1865, serviceType: EPSON_SERVICE, protocol: 'epson-esci2-tcp'};
      discovered.clear();
      discovered.set(target.id, {target, address, expires: Date.now() + SELECTION_LIFETIME});
      return target;
    },
    readNetworkSettings(id) {
      return exclusive(() => readEpsonSettings(createSession(selected(id))));
    },
    async scanNetwork(id, token, options, onImage) {
      if (scan) return {ok: false, error: 'A network scan is already running'};
      const controller = new AbortController();
      scan = {token, controller};
      try {
        const result = await exclusive(() => scanEpsonNetwork(createSession, selected(id), options, onImage, controller.signal));
        return {ok: true, ...result};
      } catch (error) { return {ok: false, error: message(error)}; }
      finally { scan = undefined; }
    },
    async stopNetworkScan(token) {
      if (scan?.token === token) scan.controller.abort();
    },
  };
}
