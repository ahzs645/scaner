import {Scanner} from '../scanner.js';
import {ScannerRegistry} from '../registry.js';
import type {DriverOptions, DriverRegistration} from '../driver.js';
import {FF680W_PROFILE} from './ff680w.js';
import type {EscI2Profile} from './esci2.js';

export {FF680W_PROFILE};
export type {EscI2Profile};
export const SUPPORTED_DRIVERS: readonly DriverRegistration[] = Object.freeze([
  Object.freeze({profile: FF680W_PROFILE, factory: (context: import('../driver.js').DriverContext) =>
    new Scanner(context.usb, context.log, context.onDisconnect, context.transferTimeout,
      context.profile as EscI2Profile, context.device)}),
]);
export function createDefaultRegistry(usb: USB, options: DriverOptions = {}): ScannerRegistry {
  return new ScannerRegistry(usb, SUPPORTED_DRIVERS, options);
}
