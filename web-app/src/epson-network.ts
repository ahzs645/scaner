import {buildHeader, compact, errorTokens, ImageBatch, replyLength, tokens} from './protocol.js';
import type {Reply} from './protocol.js';
import {FF680W_PROFILE} from './profiles/ff680w.js';
import type {Capabilities, CapturedImage, DeviceSettings, ScanOptions, ScanResult} from './driver.js';

const MAX_SETTINGS_BYTES = 1024 * 1024;
export const MAX_IMAGE_BLOCK_BYTES = 16 * 1024 * 1024;
const MAX_JOB_BYTES = 512 * 1024 * 1024;
const READ_COMMANDS = new Set(['INFO', 'CAPA', 'RESA', 'STAT']);
const ACQUISITION_COMMANDS = new Set(['PARA', 'MECH', 'TRDT', 'IMG ', 'CAN ']);
const IDLE_GREETING = [1, 4, 0, 0, 0];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface EpsonSocket {
  readonly opened: Promise<unknown>;
  readonly closed: boolean;
  read(): Promise<Uint8Array | undefined>;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  destroy(): void;
}
export type OpenEpsonSocket = (host: string, port: number) => EpsonSocket;
export interface EpsonConnectionOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
  allowAcquisition?: boolean;
}

export function networkPacket(opcode: number, payload: Uint8Array = new Uint8Array(), expected = 0, maximum = MAX_SETTINGS_BYTES): Uint8Array {
  if (!Number.isSafeInteger(maximum) || maximum < MAX_SETTINGS_BYTES || maximum > MAX_IMAGE_BLOCK_BYTES) throw Error('Invalid network frame limit');
  if (![opcode, expected, payload.length].every(Number.isSafeInteger) || opcode < 0 || opcode > 0xffff
    || expected < 0 || expected > maximum || payload.length > MAX_SETTINGS_BYTES) throw Error('Invalid network frame size');
  const passthrough = opcode >>> 8 === 0x20;
  const packet = new Uint8Array(12 + (passthrough ? 8 : 0) + payload.length);
  const header = new DataView(packet.buffer);
  header.setUint16(0, 0x4953);
  header.setUint16(2, opcode);
  header.setUint16(4, 12);
  header.setUint32(6, packet.length - 12);
  if (passthrough) {
    header.setUint32(12, payload.length);
    header.setUint32(16, expected);
  }
  packet.set(payload, passthrough ? 20 : 12);
  return packet;
}

function bounded<T>(operation: PromiseLike<T>, ms: number, timeout: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    const stop = () => { cleanup(); reject(Error('Network scan stopped')); };
    const timer = setTimeout(() => { cleanup(); reject(Error(timeout)); }, ms);
    signal?.addEventListener('abort', stop, {once: true});
    // Observe the original promise even if a timeout or abort wins the race.
    void Promise.resolve(operation).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) stop();
  });
}

/** Retain both the buffered header and the pending stream read on interruption.
 * Cleanup can drain an in-flight response before reading the CAN/FIN reply. */
class FrameReader {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private pending?: Promise<Uint8Array | undefined>;
  constructor(private socket: EpsonSocket, private maximum: number) {}

  private async ensure(count: number, wait: (pending: Promise<Uint8Array | undefined>) => Promise<Uint8Array | undefined>): Promise<void> {
    while (this.size < count) {
      if (!this.pending) {
        this.pending = this.socket.read();
        void this.pending.catch(() => {});
      }
      const chunk = await wait(this.pending);
      this.pending = undefined;
      if (!chunk) throw Error('Network scanner closed the connection');
      if (!chunk.length) continue;
      // A TCP read can contain the end of one frame and the start of the next.
      if (this.size + chunk.length > this.maximum + 65536) throw Error('Network settings buffer exceeded its limit');
      this.chunks.push(chunk);
      this.size += chunk.length;
    }
  }

  private bytes(count: number, consume: boolean): Uint8Array {
    if (!count) return new Uint8Array();
    const first = this.chunks[0]!;
    let result: Uint8Array = first.subarray(0, count);
    let index = 0, used = count;
    if (first.length < count) {
      result = new Uint8Array(count);
      let offset = 0;
      while (offset < count) {
        const chunk = this.chunks[index]!;
        used = Math.min(chunk.length, count - offset);
        result.set(chunk.subarray(0, used), offset);
        offset += used;
        if (offset < count) index++;
      }
    }
    if (consume) {
      this.chunks.splice(0, index);
      const last = this.chunks[0]!;
      if (used === last.length) this.chunks.shift();
      else this.chunks[0] = last.subarray(used);
      this.size -= count;
    }
    return result;
  }

  async frame(stage: string, opcode: number, maximum: number, wait: (pending: Promise<Uint8Array | undefined>) => Promise<Uint8Array | undefined>): Promise<Uint8Array> {
    await this.ensure(12, wait);
    const header = this.bytes(12, false);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint16(0) !== 0x4953) throw Error(stage + ': invalid IS frame');
    if (![0x380c, 0x000c].includes(view.getUint16(4))) throw Error(stage + ': unsupported response header');
    if (view.getUint16(2) !== opcode) throw Error(stage + ': unexpected response opcode');
    const count = view.getUint32(6);
    if (count > maximum) throw Error(stage + ': response exceeds its bounded length');
    await this.ensure(12 + count, wait);
    return this.bytes(12 + count, true).subarray(12);
  }
}

export class EpsonSession {
  private socket?: EpsonSocket;
  private reader?: FrameReader;
  private deadline = 0;
  private cleanupDeadline = 0;
  private outerLocked = false;
  private controlled = false;
  private busy = false;
  private readonly maximum: number;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly deadlineMs: number;
  private readonly allowAcquisition: boolean;

  constructor(private connect: OpenEpsonSocket, private options: EpsonConnectionOptions) {
    const {port = 1865, timeoutMs = 3000, deadlineMs = 20000, allowAcquisition = false} = options;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid network scanner port');
    for (const value of [timeoutMs, deadlineMs]) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw Error('Invalid bounded network timeout');
    }
    if (typeof allowAcquisition !== 'boolean') throw Error('Invalid acquisition mode');
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.deadlineMs = deadlineMs;
    this.allowAcquisition = allowAcquisition;
    this.maximum = allowAcquisition ? MAX_IMAGE_BLOCK_BYTES : MAX_SETTINGS_BYTES;
  }

  private checkRunning(): void {
    if (this.options.signal?.aborted) throw Error('Network scan stopped');
  }

  private io<T>(operation: () => Promise<T>, stage: string, cleanup = false, interruptible = !cleanup): Promise<T> {
    if (interruptible) this.checkRunning();
    const remaining = (cleanup ? this.cleanupDeadline : this.deadline) - Date.now();
    if (remaining <= 0) throw Error('Network settings deadline exceeded');
    return bounded(operation(), Math.min(this.timeoutMs, remaining), 'Network scanner ' + stage + ' timed out',
      interruptible ? this.options.signal : undefined);
  }

  private write(packet: Uint8Array, cleanup = false, interruptible = !cleanup): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.closed) throw Error('Network scanner disconnected');
    return this.io(() => socket.write(packet), 'write', cleanup, interruptible);
  }

  private frame(stage: string, maximum: number, opcode: number, cleanup = false, interruptible = !cleanup): Promise<Uint8Array> {
    return this.reader!.frame(stage, opcode, maximum, pending => this.io(() => pending, 'read', cleanup, interruptible));
  }

  private async ack(stage: string, opcode: number): Promise<void> {
    const data = await this.frame(stage, 1, opcode, false, false);
    if (data.length !== 1 || data[0] !== 6) throw Error(stage + ': scanner did not acknowledge session ownership');
  }

  async open(): Promise<void> {
    if (this.socket) throw Error('Network session is already open');
    this.checkRunning();
    this.deadline = Date.now() + this.deadlineMs;
    const socket = this.socket = this.connect(this.options.host, this.port);
    this.reader = new FrameReader(socket, this.maximum);
    await this.io(() => socket.opened, 'connection');
    const greeting = await this.frame('WELCOME', 256, 0x8000);
    if (greeting.length !== IDLE_GREETING.length || !greeting.every((value, index) => value === IDLE_GREETING[index])) {
      throw Error('Busy or unrecognized network greeting; no lock was sent');
    }
    // Finish an outstanding ownership exchange before honoring cancellation.
    this.checkRunning();
    await this.write(networkPacket(0x2100, Uint8Array.of(1, 0xa0, 4, 0, 0, 1, 0x2c)), false, false);
    await this.ack('LOCK', 0xa100);
    this.outerLocked = true;
    this.checkRunning();
    await this.write(networkPacket(0x2000, Uint8Array.of(28, 88), 1), false, false);
    await this.ack('FSX', 0xa000);
    this.controlled = true;
    this.checkRunning();
  }

  private async command(command: string, cleanup = false, payload: Uint8Array = new Uint8Array()): Promise<Reply> {
    if (payload.length) {
      // The header requests zero bytes. The separate body requests the reply.
      await this.write(networkPacket(0x2000, buildHeader(command, payload.length)), cleanup);
      await this.write(networkPacket(0x2000, payload, 64), cleanup);
    } else await this.write(networkPacket(0x2000, buildHeader(command), 64), cleanup);

    let immediate: Uint8Array;
    for (let skipped = 0; ; skipped++) {
      immediate = await this.frame(command.trim(), cleanup ? this.maximum : 64, 0xa000, cleanup);
      if (cleanup) {
        const matches = immediate.length === 64 && command.split('').every((char, index) => immediate[index] === char.charCodeAt(0));
        if (matches) break;
      } else if (immediate.length || !this.allowAcquisition) break;
      if (skipped >= 8) throw Error('Too many unexpected network transport replies');
    }
    const header = replyLength(command, immediate);
    const maximum = command === 'IMG ' && this.allowAcquisition ? MAX_IMAGE_BLOCK_BYTES : MAX_SETTINGS_BYTES;
    if (header.length > maximum) throw Error('Advertised settings data exceeds 1 MiB');
    let data: Uint8Array = new Uint8Array();
    if (header.length) {
      await this.write(networkPacket(0x2000, new Uint8Array(), header.length, this.maximum), cleanup);
      data = await this.frame(command.trim() + ' data', header.length, 0xa000, cleanup);
      if (data.length !== header.length) throw Error('Short network settings data block');
    }
    return {header: header.header, data, items: [...tokens(immediate, 12), ...(command === 'IMG ' ? [] : tokens(data))]};
  }

  private async run(command: string, payload?: Uint8Array): Promise<Reply> {
    if (!this.controlled) throw Error('Network settings session is not ready');
    if (this.busy) throw Error('Network settings session is busy');
    this.busy = true;
    try { return await this.command(command, false, payload); }
    finally { this.busy = false; }
  }

  async query(command: string): Promise<Reply> {
    if (!READ_COMMANDS.has(command)) throw Error('Network settings command is not allowlisted');
    return this.run(command);
  }

  async acquire(command: string, payload: Uint8Array = new Uint8Array()): Promise<Reply> {
    if (!this.allowAcquisition) throw Error('Network acquisition is not enabled');
    if (!ACQUISITION_COMMANDS.has(command)) throw Error('Network acquisition command is not allowlisted');
    if (!(payload instanceof Uint8Array) || payload.length > MAX_SETTINGS_BYTES) throw Error('Invalid network parameter payload');
    if ((command === 'PARA' || command === 'MECH') !== (payload.length > 0)) throw Error('Unexpected acquisition payload');
    return this.run(command, payload);
  }

  async close({cancel = false} = {}): Promise<string[]> {
    const socket = this.socket;
    const warnings: string[] = [];
    if (!socket) return warnings;
    if (this.controlled && !socket.closed) {
      const commands = cancel && this.allowAcquisition ? ['CAN ', 'FIN '] : ['FIN '];
      for (const command of commands) {
        this.cleanupDeadline = Date.now() + this.timeoutMs;
        const stage = command === 'CAN ' ? 'Cancel' : 'Finalize';
        try { errorTokens((await this.command(command, true)).items, stage); }
        catch (error) { warnings.push(stage + ': ' + message(error)); }
      }
    }
    if (this.outerLocked && !socket.closed) {
      this.cleanupDeadline = Date.now() + Math.min(1000, this.timeoutMs);
      try { await this.write(networkPacket(0x2101), true); }
      catch (error) { warnings.push('Network unlock: ' + message(error)); }
    }
    try { await bounded(socket.close(), Math.min(100, this.timeoutMs), 'Network close timed out'); }
    catch { socket.destroy(); }
    this.socket = undefined;
    this.reader = undefined;
    this.outerLocked = this.controlled = false;
    return warnings;
  }
}

export function requireFF680W(info: Reply): void {
  const products = info.items.filter(item => item.name === 'PRD');
  if (products.length !== 1 || products[0]!.value !== 'h007FF-680W') throw Error('Network device identity is not the supported FF-680W');
}

export async function readEpsonSettings(session: EpsonSession): Promise<{settings: DeviceSettings; capabilities: Capabilities; warnings: string[]}> {
  const settings: DeviceSettings = {};
  let primary: unknown, warnings: string[];
  try {
    await session.open();
    const info = await session.query('INFO');
    errorTokens(info.items, 'INFO');
    requireFF680W(info);
    settings.INFO = info.items.map(compact);
    for (const command of ['CAPA', 'RESA', 'STAT']) {
      const reply = await session.query(command);
      if (command !== 'STAT') errorTokens(reply.items, command);
      settings[command] = reply.items.map(compact);
    }
  } catch (error) { primary = error instanceof Error ? error : Error(String(error)); }
  finally { warnings = await session.close(); }
  if (primary) throw Object.assign(Error(message(primary), {cause: primary}), {warnings});
  return {settings, capabilities: FF680W_PROFILE.decodeCapabilities(settings.CAPA!), warnings};
}

function checkCapabilities(caps: Capabilities, options: ScanOptions): void {
  if (!caps.resolutions.includes(options.dpi)) throw Error('Network scanner does not advertise requested DPI');
  if (options.duplex && !caps.duplex) throw Error('Network scanner does not advertise duplex');
  if (!caps[options.mode]) throw Error('Network scanner does not advertise requested color mode');
  if (options.deskew && !caps.deskew) throw Error('Network scanner does not advertise deskew');
  if (options.double_feed && !caps.doubleFeed) throw Error('Network scanner does not advertise double-feed detection');
  if (options.auto_crop && (!caps.crop || !caps.cropResolutions.includes(options.dpi))) throw Error('Network scanner does not advertise requested automatic crop');
  if (options.quality < caps.quality.min || options.quality > caps.quality.max) throw Error('Network scanner does not advertise requested JPEG quality');
}

export async function scanEpsonNetwork(
  createSession: (options: EpsonConnectionOptions) => EpsonSession, connectionOptions: EpsonConnectionOptions,
  requestedOptions: ScanOptions, onImage: (image: CapturedImage) => void | Promise<void>,
  signal = connectionOptions.signal,
): Promise<ScanResult> {
  const options = structuredClone(requestedOptions);
  const plan = FF680W_PROFILE.buildScanPlan(options);
  if (typeof onImage !== 'function') throw Error('Network scan requires an image callback');
  const duration = connectionOptions.deadlineMs ?? 300000;
  const deadline = Date.now() + duration;
  const remaining = () => {
    if (signal?.aborted) throw Error('Network scan stopped');
    const ms = deadline - Date.now();
    if (ms <= 0) throw Error('Network scan deadline exceeded');
    return ms;
  };
  remaining();
  const session = createSession({...connectionOptions, deadlineMs: duration, signal, allowAcquisition: true});
  const batch = new ImageBatch(options, 24 * 1024 * 1024);
  let attempted = false, saved = 0, jobBytes = 0, primary: unknown, warnings: string[];
  try {
    await session.open();
    remaining();
    const info = await session.query('INFO');
    errorTokens(info.items, 'INFO');
    requireFF680W(info);
    const capa = await session.query('CAPA');
    errorTokens(capa.items, 'CAPA');
    const settings = {CAPA: capa.items.map(compact)};
    checkCapabilities(FF680W_PROFILE.decodeCapabilities(settings.CAPA), options);
    errorTokens((await session.query('STAT')).items, 'Scanner status');
    for (const action of FF680W_PROFILE.mechanicalActions(settings)) {
      remaining();
      errorTokens((await session.acquire('MECH', new TextEncoder().encode(action))).items, 'Feeder load');
    }
    remaining();
    const para = await session.acquire('PARA', plan.payload);
    errorTokens(para.items, 'Parameters');
    if (!para.items.some(item => item.name === 'par' && item.value === 'OK  ')) throw Error('Network scanner did not accept parameters');
    remaining();
    attempted = true;
    errorTokens((await session.acquire('TRDT')).items, 'Scan start');
    while (!batch.done) {
      remaining();
      const block = await session.acquire('IMG ');
      jobBytes += block.data.length;
      if (jobBytes > MAX_JOB_BYTES) throw Error('Network scan exceeds the 512 MiB job limit');
      const image = batch.accept(block);
      if (image) {
        const ms = remaining();
        await bounded(Promise.resolve(onImage(image)), ms, 'Network scan deadline exceeded', signal);
        saved++;
      }
      if (!batch.done && !block.data.length) {
        await bounded(new Promise(resolve => setTimeout(resolve, 100)), remaining(), 'Network scan deadline exceeded', signal);
      }
    }
    batch.validate();
  } catch (error) { primary = error instanceof Error ? error : Error(String(error)); }
  finally { warnings = await session.close({cancel: attempted && !batch.done}); }
  if (primary) {
    const error = Error(message(primary) + (saved ? ` · ${saved} completed images preserved` : '')
      + (warnings.length ? ' · Cleanup warning' : ''), {cause: primary});
    throw Object.assign(error, {warnings, images: saved});
  }
  return {sheets: batch.counts.front, images: saved, warnings};
}
