import {Socket, isIP} from 'node:net';
import {EpsonSession, networkPacket as encodePacket, readEpsonSettings} from '../dist/epson-network.js';
export {MAX_IMAGE_BLOCK_BYTES, requireFF680W} from '../dist/epson-network.js';

export function networkPacket(...args) {
  return Buffer.from(encodePacket(...args));
}

function openNodeSocket(host, port) {
  const socket = new Socket();
  const reader = socket.iterator({destroyOnReturn:false});
  const opened = new Promise((resolve, reject) => {
    const failed = error => {socket.off('connect', connected); reject(error);};
    const connected = () => {socket.off('error', failed); resolve();};
    socket.once('connect', connected);
    socket.once('error', failed);
    socket.connect({host, port});
  });
  // The stream can fail between operations, including during socket teardown.
  socket.on('error', () => {});
  return {
    opened,
    get closed() {return socket.destroyed;},
    async read() {const chunk = await reader.next(); return chunk.done ? undefined : chunk.value;},
    write: bytes => new Promise((resolve, reject) => socket.write(bytes, error => error ? reject(error) : resolve())),
    close: () => new Promise(resolve => {
      if (socket.destroyed) {resolve(); return;}
      socket.once('close', resolve);
      socket.end();
    }),
    destroy: () => socket.destroy(),
  };
}

export class NodeFramedSession extends EpsonSession {
  constructor(options = {}) {
    if (typeof options.host !== 'string' || !isIP(options.host)) throw Error('Network scanner host must be a numeric IP address');
    super(openNodeSocket, options);
  }
}

export async function readNetworkSettings(options) {
  return readEpsonSettings(new NodeFramedSession({...options, allowAcquisition:false}));
}
