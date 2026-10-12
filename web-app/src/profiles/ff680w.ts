import {DEFAULT_OPTIONS, DEVICE_INPUT_RESOLUTIONS, buildScanPlan} from '../planner.js';
import {capabilities} from '../capabilities.js';
import type {EscI2Profile} from './esci2.js';

/** This is the only advertised supported model; its payload serializer retains
 * the existing FF-680W LUT, geometry, feature constraints, and defaults. */
export const FF680W_PROFILE: EscI2Profile = Object.freeze({
  id: 'epson-ff680w',
  label: 'Epson FF-680W',
  devices: Object.freeze([Object.freeze({vendorId: 0x04b8, productId: 0x016b})]),
  usbInterface: Object.freeze({number: 0}),
  settingsCommands: Object.freeze(['INFO', 'CAPA', 'RESA', 'STAT']),
  defaults: DEFAULT_OPTIONS,
  buildScanPlan,
  decodeCapabilities: (items: unknown[]) => capabilities(items, {
    resolutions: DEVICE_INPUT_RESOLUTIONS, cropResolutions: [300, 600],
  }),
  mechanicalActions: (settings: Record<string, object[]>) =>
    (settings.CAPA ?? []).some(item => 'name' in item && item.name === 'ADF'
      && 'value' in item && typeof item.value === 'string' && item.value.includes('LOAD'))
      ? ['#ADFLOAD'] : [],
});
