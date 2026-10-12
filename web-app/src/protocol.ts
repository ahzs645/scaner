// ESC/I-2 framing and duplex routing from this project's hardware-tested JS path.
const encoder = new TextEncoder();
const decoder = new TextDecoder('latin1');
export interface Token { name: string; value: string; raw: Uint8Array; channel?: string; binaryBytes?: number }
export interface Reply { items: Token[]; data: Uint8Array; header: string }
export interface CapturedImage { image: Uint8Array; filename: string; sheet: number; side: 'front' | 'back' }
export function buildHeader(command: string, length = 0): Uint8Array {
  if (!/^[\x20-\x7e]{4}$/.test(command) || !Number.isInteger(length) || length < 0 || length > 0xfffffff) throw Error('Invalid command or payload length');
  return encoder.encode(command + 'x' + length.toString(16).padStart(7, '0'));
}
export function replyLength(command: string, bytes: Uint8Array): {header: string; length: number} {
  if (bytes.length !== 64) throw Error(`Short ${command} reply (${bytes.length})`);
  const header = decoder.decode(bytes.subarray(0, 12));
  if (header.slice(0, 4) !== command || !/^x[0-9a-fA-F]{7}$/.test(header.slice(4))) throw Error(`Unexpected reply ${header}`);
  const length = parseInt(header.slice(5), 16);
  if (length > 16 * 1024 * 1024) throw Error('Invalid image/data length');
  return {header, length};
}
export function tokens(bytes: Uint8Array, offset = 0): Token[] {
  const result: Token[] = []; const channels = new Set(['MONO', 'RED ', 'GRN ', 'BLU ']);
  let pos = offset;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 35) {pos++; continue;}
    const name = decoder.decode(bytes.subarray(pos + 1, pos + 4)); if (name === '---') break;
    const begin = pos + 4, channel = decoder.decode(bytes.subarray(begin, begin + 4));
    let end = begin, binaryBytes: number | undefined;
    if (name === 'GMT' && channels.has(channel) && bytes[begin + 4] === 104) {
      const count = decoder.decode(bytes.subarray(begin + 5, begin + 8));
      if (!/^[0-9a-fA-F]{3}$/.test(count)) throw Error('Invalid tone table length');
      binaryBytes = parseInt(count, 16); end = begin + 8 + binaryBytes;
      if (end > bytes.length) throw Error('Truncated tone table');
    } else while (end < bytes.length && bytes[end] !== 35 && bytes[end] !== 0) end++;
    const raw = bytes.slice(begin, end); const item: Token = {name, value: decoder.decode(raw), raw};
    if (binaryBytes !== undefined) Object.assign(item, {channel: channel.trim(), binaryBytes});
    result.push(item); pos = Math.max(end, begin);
  }
  return result;
}
export function compact(t: Token): object {return t.binaryBytes === undefined ? {name:t.name,value:t.value} : {name:t.name,channel:t.channel,binary_bytes:t.binaryBytes};}
export function errorTokens(items: Token[], stage: string): void {
  for (const t of items) if (['err', 'atn', 'nrd'].includes(t.name.toLowerCase())) throw Error(`${stage}: ${t.name}=${t.value.trim()}`);
}
export function merge(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0)); let position = 0;
  for (const chunk of chunks) {output.set(chunk, position); position += chunk.length;} return output;
}
export class ImageBatch {
  readonly counts = {front:0, back:0}; readonly chunks: Record<'front'|'back',Uint8Array[]> = {front:[],back:[]};
  private lengths = {front:0, back:0}; private side: 'front'|'back' = 'front'; done = false;
  constructor(private options: {duplex:boolean;max_sheets:number}, private maxImageBytes = 24 * 1024 * 1024) {}
  accept(block: Reply): CapturedImage | undefined {
    errorTokens(block.items, 'Image transfer');
    const typ = block.items.find(t => t.name === 'typ');
    if (typ) {if (!['IMGA','IMGB'].includes(typ.value)) throw Error('Unknown image surface'); this.side = typ.value === 'IMGB' ? 'back':'front';}
    const side = this.side; if (side === 'back' && !this.options.duplex) throw Error('Unexpected back image');
    if (this.lengths[side] + block.data.length > this.maxImageBytes) throw Error('Image exceeds browser memory limit');
    if (block.data.length) {this.chunks[side].push(block.data); this.lengths[side] += block.data.length;}
    let completed: CapturedImage | undefined;
    if (block.items.some(t => t.name === 'pen')) {
      const image = merge(this.chunks[side]);
      if (image[0] !== 255 || image[1] !== 216 || image.at(-2) !== 255 || image.at(-1) !== 217) throw Error('Incomplete JPEG '+side);
      const sheet = this.counts[side] + 1;
      if (this.options.max_sheets && sheet > this.options.max_sheets) throw Error('Scanner exceeded sheet limit');
      completed = {image, side, sheet, filename:String(sheet).padStart(3,'0')+'-'+side+'.jpg'};
      this.counts[side] = sheet; this.chunks[side] = []; this.lengths[side] = 0;
    }
    if (block.items.some(t => t.name === 'lft' && t.value === 'd000')) this.done = true;
    return completed;
  }
  validate(): void {
    if (!this.done) throw Error('Job timed out');
    if (this.lengths.front || this.lengths.back || !this.counts.front || (this.options.duplex && this.counts.front !== this.counts.back)) throw Error('Incomplete job');
  }
}
