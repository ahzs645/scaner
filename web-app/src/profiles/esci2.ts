import type {ScanOptions, DeviceSettings, ScannerProfile} from '../driver.js';

/** Only the ESC/I-2 driver requires these hooks. Other protocols implement the
 * common ScannerDriver contract using their own profile and factory. */
export interface EscI2Profile extends ScannerProfile {
  readonly usbInterface: { readonly number: number; readonly configurationValue?: number };
  readonly settingsCommands: readonly string[];
  buildScanPlan(options: ScanOptions): { payload: Uint8Array };
  mechanicalActions(settings: DeviceSettings): readonly string[];
}
