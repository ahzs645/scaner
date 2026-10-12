const enc = new TextEncoder();
const dec = new TextDecoder('latin1');
const channels = new Set(['MONO', 'RED ', 'GRN ', 'BLU ']);

export function buildHeader(command, length = 0) {
  if (!/^[\x20-\x7e]{4}$/.test(command) || !Number.isInteger(length) || length < 0 || length > 0xfffffff)
    throw Error('Invalid command or payload length');
  return enc.encode(command + 'x' + length.toString(16).padStart(7, '0'));
}

export function replyLength(command, bytes) {
  if (bytes.length !== 64) throw Error(`Short ${command} reply (${bytes.length})`);
  const header = dec.decode(bytes.subarray(0, 12));
  if (header.slice(0, 4) !== command || !/^x[0-9a-fA-F]{7}$/.test(header.slice(4)))
    throw Error(`Unexpected reply ${header}`);
  const length = parseInt(header.slice(5), 16);
  if (length > 16 * 1024 * 1024) throw Error('Invalid image/data length');
  return { header, length };
}

export function tokens(bytes, offset = 0) {
  const items = [];
  let pos = offset;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 35) { pos++; continue; }
    const name = dec.decode(bytes.subarray(pos + 1, pos + 4));
    if (name === '---') break;
    const begin = pos + 4;
    const channel = dec.decode(bytes.subarray(begin, begin + 4));
    let end = begin, binaryBytes;
    // CAPA GMTLIST is text. Only a known channel followed by hNNN is a LUT.
    if (name === 'GMT' && channels.has(channel) && bytes[begin + 4] === 104) {
      const sizeText = dec.decode(bytes.subarray(begin + 5, begin + 8));
      if (!/^[0-9a-fA-F]{3}$/.test(sizeText)) throw Error('Invalid tone table length');
      binaryBytes = parseInt(sizeText, 16);
      end = begin + 8 + binaryBytes;
      if (end > bytes.length) throw Error('Truncated tone table');
    } else {
      while (end < bytes.length && bytes[end] !== 35 && bytes[end] !== 0) end++;
    }
    const raw = bytes.slice(begin, end);
    const item = { name, value: dec.decode(raw), raw };
    if (binaryBytes !== undefined) Object.assign(item, { channel: channel.trim(), binaryBytes });
    items.push(item);
    pos = Math.max(end, begin);
  }
  return items;
}

export function compact(t) {
  return t.binaryBytes === undefined ? { name: t.name, value: t.value }
    : { name: t.name, channel: t.channel, binary_bytes: t.binaryBytes };
}

export function errorTokens(items, stage) {
  for (const t of items)
    if (['err', 'atn', 'nrd'].includes(t.name.toLowerCase()))
      throw Error(`${stage}: ${t.name}=${t.value.trim()}`);
}

export function merge(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

export class ImageBatch {
  constructor({ duplex = false, max_sheets = 0 } = {}) {
    this.duplex = duplex;
    this.maxSheets = max_sheets;
    this.counts = { front: 0, back: 0 };
    this.chunks = { front: [], back: [] };
    this.side = 'front';
    this.done = false;
  }
  accept(block) {
    errorTokens(block.items, 'Image transfer');
    const typ = block.items.find(t => t.name === 'typ');
    if (typ) {
      if (!['IMGA', 'IMGB'].includes(typ.value)) throw Error('Unknown image surface');
      this.side = typ.value === 'IMGB' ? 'back' : 'front';
    }
    const side = this.side;
    if (side === 'back' && !this.duplex) throw Error('Unexpected back image');
    if (block.data.length) this.chunks[side].push(block.data);
    let completed;
    if (block.items.some(t => t.name === 'pen')) {
      const image = merge(this.chunks[side]);
      if (image[0] !== 255 || image[1] !== 216 || image.at(-2) !== 255 || image.at(-1) !== 217)
        throw Error('Incomplete JPEG ' + side);
      const sheet = this.counts[side] + 1;
      if (this.maxSheets && sheet > this.maxSheets) throw Error('Scanner exceeded sheet limit');
      completed = { image, side, sheet, filename: String(sheet).padStart(3, '0') + '-' + side + '.jpg' };
      this.counts[side] = sheet;
      this.chunks[side] = [];
    }
    if (block.items.some(t => t.name === 'lft' && t.value === 'd000')) this.done = true;
    return completed;
  }
  validate() {
    if (!this.done) throw Error('Job timed out');
    if (this.chunks.front.length || this.chunks.back.length || !this.counts.front ||
        (this.duplex && this.counts.front !== this.counts.back))
      throw Error('Incomplete job');
  }
}

// FIN ends the ESC/I-2 session and releases its lock; SANE does not use FS Y.
// A failed cancel must not prevent finalization.
export async function cleanupSession(io, { locked, done, acquisitionAttempted = false }, onError) {
  if (!locked) return;
  const actions = [...(!acquisitionAttempted || done ? [] : [['Cancel', () => io.query('CAN ')]]),
    ['Finalize', async () => { const reply=await io.query('FIN '); errorTokens(reply?.items||[], 'Finalize'); }]];
  for (const [label, action] of actions) {
    try { await action(); } catch (e) { onError(label + ': ' + e.message); }
  }
}
