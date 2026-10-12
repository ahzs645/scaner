import {Socket, isIP} from 'node:net';
import {buildHeader, compact, errorTokens, replyLength, tokens} from '../dist/protocol.js';
import {FF680W_PROFILE} from '../dist/profiles/ff680w.js';

const MAX_SETTINGS_BYTES = 1024 * 1024;
export const MAX_IMAGE_BLOCK_BYTES = 16 * 1024 * 1024;
const READ_COMMANDS = new Set(['INFO', 'CAPA', 'RESA', 'STAT']);
const ACQUISITION_COMMANDS = new Set(['PARA','MECH','TRDT','IMG ','CAN ']);
const message = error => error instanceof Error ? error.message : String(error);

/** Pure framing codec. Only NodeFramedSession's allowlisted operations send it. */
export function networkPacket(opcode, payload = new Uint8Array(), expected = 0, maximum = MAX_SETTINGS_BYTES) {
  if(!Number.isSafeInteger(maximum) || maximum < MAX_SETTINGS_BYTES || maximum > MAX_IMAGE_BLOCK_BYTES) throw Error('Invalid network frame limit');
  if(![opcode, expected, payload.length].every(Number.isSafeInteger) || opcode < 0 || opcode > 0xffff
    || expected < 0 || expected > maximum || payload.length > MAX_SETTINGS_BYTES) throw Error('Invalid network frame size');
  const passthrough = opcode >>> 8 === 0x20;
  const packet = Buffer.alloc(12 + (passthrough ? 8 : 0) + payload.length);
  packet.write('IS', 0, 'ascii'); packet.writeUInt16BE(opcode, 2); packet.writeUInt16BE(12, 4);
  packet.writeUInt32BE(payload.length + (passthrough ? 8 : 0), 6);
  if(passthrough) {packet.writeUInt32BE(payload.length, 12); packet.writeUInt32BE(expected, 16);}
  packet.set(payload, passthrough ? 20 : 12);
  return packet;
}

/** TCP has no message boundaries: exact reads retain fragmented/coalesced data.
 * Buffers and pending waits are bounded independently of an advertised length. */
class ExactReader {
  chunks = []; size = 0; failure; pending;
  constructor(socket, maximum = MAX_SETTINGS_BYTES) {
    this.socket = socket;
    this.maximum = maximum;
    this.onData = bytes => {
      if(this.failure) return;
      if(this.size + bytes.length > this.maximum + 12) {this.fail(Error('Network settings buffer exceeded its limit')); socket.destroy(); return;}
      this.chunks.push(bytes); this.size += bytes.length; this.deliver();
    };
    this.onError = error => this.fail(error);
    this.onEnd = () => this.fail(Error('Network scanner closed the connection'));
    socket.on('data', this.onData); socket.on('error', this.onError);
    socket.on('end', this.onEnd); socket.on('close', this.onEnd);
  }
  take(count) {
    const result = Buffer.alloc(count); let offset = 0;
    while(offset < count) {
      const first = this.chunks[0], amount = Math.min(first.length, count - offset);
      result.set(first.subarray(0, amount), offset); offset += amount; this.size -= amount;
      if(amount === first.length) this.chunks.shift(); else this.chunks[0] = first.subarray(amount);
    }
    return result;
  }
  deliver() {
    if(this.pending && this.size >= this.pending.count) {
      const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.resolve(this.take(pending.count));
    }
  }
  fail(error) {
    this.failure ??= error;
    this.cancelPending(error);
  }
  cancelPending(error) {
    if(this.pending) {const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.reject(error);}
  }
  read(count, timeout) {
    if(!Number.isSafeInteger(count) || count < 0 || count > this.maximum) return Promise.reject(Error('Invalid bounded network read'));
    if(this.pending) return Promise.reject(Error('Network reader is busy'));
    if(this.size >= count) return Promise.resolve(this.take(count));
    if(this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const pending = {count, resolve, reject, timer: setTimeout(() => {
        if(this.pending === pending) this.pending = undefined;
        reject(Error('Network scanner read timed out'));
      }, timeout)};
      this.pending = pending;
    });
  }
  dispose() {
    this.fail(Error('Network session closed'));
    this.socket.off('data', this.onData); this.socket.off('error', this.onError);
    this.socket.off('end', this.onEnd); this.socket.off('close', this.onEnd);
    this.chunks = []; this.size = 0;
  }
}

/** Read-only by default. Acquisition requires an explicit native-driver opt-in;
 * metadata remains bounded to 1 MiB even in acquisition mode. */
export class NodeFramedSession {
  #socket; #reader; #deadline; #cleanupDeadline; #outerLocked = false; #controlled = false;
  #busy = false; #aborted = false; #onAbort; #allowAcquisition; #maximum;
  constructor({host, port = 1865, timeoutMs = 3000, deadlineMs = 20000, signal, allowAcquisition = false} = {}) {
    if(typeof host !== 'string' || !isIP(host)) throw Error('Network scanner host must be a numeric IP address');
    if(!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid network scanner port');
    for(const value of [timeoutMs, deadlineMs]) if(!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw Error('Invalid bounded network timeout');
    if(typeof allowAcquisition !== 'boolean') throw Error('Invalid acquisition mode');
    this.#allowAcquisition = allowAcquisition;
    this.#maximum = allowAcquisition ? MAX_IMAGE_BLOCK_BYTES : MAX_SETTINGS_BYTES;
    Object.assign(this, {host, port, timeoutMs, deadlineMs, signal});
  }
  #time(cleanup = false) {
    if(!cleanup && (this.#aborted || this.signal?.aborted)) throw Error('Network settings stopped');
    const remaining = (cleanup ? this.#cleanupDeadline : this.#deadline) - Date.now();
    if(remaining <= 0) throw Error('Network settings deadline exceeded');
    return Math.min(this.timeoutMs, remaining);
  }
  async #write(packet, cleanup = false) {
    if(!this.#socket || this.#socket.destroyed) throw Error('Network scanner disconnected');
    const timeout = this.#time(cleanup);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Network scanner write timed out')), timeout);
      this.#socket.write(packet, error => {clearTimeout(timer); if(error) reject(error); else resolve();});
    });
  }
  async #frame(stage, maximum, opcode, cleanup = false) {
    const header = await this.#reader.read(12, this.#time(cleanup));
    if(header.subarray(0, 2).toString('ascii') !== 'IS') throw Error(stage + ': invalid IS frame');
    if(![0x380c, 0x000c].includes(header.readUInt16BE(4))) throw Error(stage + ': unsupported response header');
    if(header.readUInt16BE(2) !== opcode) throw Error(stage + ': unexpected response opcode');
    const count = header.readUInt32BE(6);
    if(count > maximum) throw Error(stage + ': response exceeds its bounded length');
    return this.#reader.read(count, this.#time(cleanup));
  }
  async #ack(stage, opcode) {
    const data = await this.#frame(stage, 1, opcode);
    if(data.length !== 1 || data[0] !== 6) throw Error(stage + ': scanner did not acknowledge session ownership');
  }
  async open() {
    if(this.#socket) throw Error('Network session is already open');
    if(this.signal?.aborted) throw Error('Network settings stopped');
    this.#deadline = Date.now() + this.deadlineMs;
    this.#aborted = false;
    this.#socket = new Socket(); this.#reader = new ExactReader(this.#socket, this.#maximum);
    this.#onAbort = () => {
      this.#aborted = true;
      if(this.#allowAcquisition && !this.#socket.connecting) this.#reader.cancelPending(Error('Network scan stopped'));
      else {this.#reader.fail(Error('Network settings stopped')); this.#socket.destroy();}
    };
    this.signal?.addEventListener('abort', this.#onAbort, {once:true});
    await new Promise((resolve, reject) => {
      const socket = this.#socket, finish = error => {
        clearTimeout(timer); socket.off('connect', connected); socket.off('error', failed); socket.off('close', closed);
        if(error) reject(error); else resolve();
      };
      const connected = () => finish(), failed = error => finish(error), closed = () => finish(Error(this.#aborted ? 'Network settings stopped' : 'Network scanner closed during connection'));
      const timer = setTimeout(() => {finish(Error('Network scanner connection timed out')); socket.destroy();}, this.#time());
      socket.once('connect', connected); socket.once('error', failed); socket.once('close', closed);
      socket.connect({host:this.host, port:this.port});
    });
    const greeting = await this.#frame('WELCOME', 256, 0x8000);
    if(greeting.toString('hex') !== '0104000000') throw Error('Busy or unrecognized network greeting; no lock was sent');
    await this.#write(networkPacket(0x2100, Buffer.from('01a0040000012c','hex')));
    await this.#ack('LOCK', 0xa100); this.#outerLocked = true;
    await this.#write(networkPacket(0x2000, Uint8Array.of(28,88), 1));
    await this.#ack('FSX', 0xa000); this.#controlled = true;
  }
  async #query(command, cleanup = false, payload = new Uint8Array()) {
    if(payload.length) {
      // SANE and Epson packet captures: header expects ZERO bytes, followed by
      // a distinct parameter-body frame requesting the 64-byte PARA/MECH reply.
      await this.#write(networkPacket(0x2000, buildHeader(command, payload.length), 0), cleanup);
      await this.#write(networkPacket(0x2000, payload, 64), cleanup);
    } else await this.#write(networkPacket(0x2000, buildHeader(command), 64), cleanup);
    let immediate;
    for(let skipped = 0; ; skipped++) {
      immediate = await this.#frame(command.trim(), 64, 0xa000, cleanup);
      if(immediate.length || !this.#allowAcquisition) break;
      if(skipped >= 8) throw Error('Too many empty network transport acknowledgements');
    }
    const header = replyLength(command, immediate);
    const maximum = command === 'IMG ' && this.#allowAcquisition ? MAX_IMAGE_BLOCK_BYTES : MAX_SETTINGS_BYTES;
    if(header.length > maximum) throw Error('Advertised settings data exceeds 1 MiB');
    let data = new Uint8Array();
    if(header.length) {
      await this.#write(networkPacket(0x2000, new Uint8Array(), header.length, this.#maximum), cleanup);
      data = await this.#frame(command.trim() + ' data', header.length, 0xa000, cleanup);
      if(data.length !== header.length) throw Error('Short network settings data block');
    }
    // JPEG bytes may contain '#' and NUL: never decode them as control tokens.
    return {header:header.header, data, items:[...tokens(immediate,12), ...(command==='IMG '?[]:tokens(data))]};
  }
  async query(command) {
    if(!READ_COMMANDS.has(command)) throw Error('Network settings command is not allowlisted');
    if(!this.#controlled) throw Error('Network settings session is not ready');
    if(this.#busy) throw Error('Network settings session is busy');
    this.#busy = true;
    try {return await this.#query(command);} finally {this.#busy = false;}
  }
  async acquire(command, payload = new Uint8Array()) {
    if(!this.#allowAcquisition) throw Error('Network acquisition is not enabled');
    if(!ACQUISITION_COMMANDS.has(command)) throw Error('Network acquisition command is not allowlisted');
    if(!(payload instanceof Uint8Array) || payload.length > MAX_SETTINGS_BYTES) throw Error('Invalid network parameter payload');
    if((command==='PARA'||command==='MECH') !== (payload.length>0)) throw Error('Unexpected acquisition payload');
    if(!this.#controlled) throw Error('Network settings session is not ready');
    if(this.#busy) throw Error('Network settings session is busy');
    this.#busy = true;
    try {return await this.#query(command,false,payload);} finally {this.#busy = false;}
  }
  async close({cancel = false} = {}) {
    const warnings = [];
    if(!this.#socket) return warnings;
    this.signal?.removeEventListener('abort', this.#onAbort);
    if(cancel && this.#allowAcquisition && this.#controlled && !this.#socket.destroyed) {
      this.#cleanupDeadline = Date.now() + this.timeoutMs;
      try {errorTokens((await this.#query('CAN ',true)).items, 'Cancel');}
      catch(error) {warnings.push('Cancel: ' + message(error));}
    }
    if(this.#controlled && !this.#socket.destroyed) {
      this.#cleanupDeadline = Date.now() + this.timeoutMs;
      try {errorTokens((await this.#query('FIN ', true)).items, 'Finalize');}
      catch(error) {warnings.push('Finalize: ' + message(error));}
    }
    if(this.#outerLocked && !this.#socket.destroyed) {
      // Release has its own budget, even if FIN consumed its cleanup deadline.
      this.#cleanupDeadline = Date.now() + Math.min(1000, this.timeoutMs);
      try {await this.#write(networkPacket(0x2101), true);}
      catch(error) {warnings.push('Network unlock: ' + message(error));}
    }
    const socket = this.#socket;
    // Graceful end flushes a successful outer unlock; bound descriptor teardown.
    await new Promise(resolve => {
      let settled = false;
      const done = () => {if(settled) return; settled = true; clearTimeout(timer); socket.off('close', done); resolve();};
      const timer = setTimeout(() => {socket.destroy(); done();}, Math.min(100, this.timeoutMs));
      if(socket.destroyed) {done(); return;}
      socket.once('close', done); socket.end();
    });
    this.#reader.dispose(); this.#reader = undefined; this.#socket = undefined;
    this.#outerLocked = false; this.#controlled = false;
    return warnings;
  }
}

export function requireFF680W(info) {
  const products = info.items.filter(item => item.name === 'PRD');
  if(products.length !== 1 || products[0].value !== 'h007FF-680W') throw Error('Network device identity is not the supported FF-680W');
}

/** Settings proof, not a network scan implementation. The renderer sees
 * compact tokens and constraints; all TCP access stays in Electron's main process. */
export async function readNetworkSettings(options) {
  const session = new NodeFramedSession({...options,allowAcquisition:false}), settings = {}; let primary, warnings = [];
  try {
    await session.open();
    const info = await session.query('INFO'); errorTokens(info.items, 'INFO'); requireFF680W(info);
    settings.INFO = info.items.map(compact);
    for(const command of ['CAPA','RESA','STAT']) {
      const reply = await session.query(command);
      // STAT can report empty feeder/cover status while metadata reads succeed.
      if(command !== 'STAT') errorTokens(reply.items, command);
      settings[command] = reply.items.map(compact);
    }
  } catch(error) {primary = error;}
  finally {warnings = await session.close();}
  if(primary) {const error = Error(message(primary), {cause:primary}); error.warnings = warnings; throw error;}
  return {settings, capabilities:FF680W_PROFILE.decodeCapabilities(settings.CAPA), warnings};
}
