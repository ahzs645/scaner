import {scanEpsonNetwork} from '../dist/epson-network.js';
import {NodeFramedSession} from './network-settings.mjs';

export async function scanNetwork(connectionOptions, requestedOptions, onImage, signal = connectionOptions?.signal) {
  return scanEpsonNetwork(options => new NodeFramedSession(options), connectionOptions ?? {}, requestedOptions, onImage, signal);
}
