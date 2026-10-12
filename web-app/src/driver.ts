import type {ColorDeviceIdentity} from './color/identity.js';
import type {ScanOptions} from './planner.js';
import type {CapturedImage} from './protocol.js';
import type {Capabilities} from './capabilities.js';

// These existing data types contain no protocol implementation. Re-export them
// here so clients can depend on the driver contract alone.
export type {ScanOptions, CapturedImage, Capabilities};
export type DeviceSettings = Record<string, object[]>;
export interface DeviceIdentity { readonly vendorId: number; readonly productId: number }
export interface ScannerProfile {
  readonly id: string;
  readonly label: string;
  readonly devices: readonly DeviceIdentity[];
  readonly defaults: Readonly<ScanOptions>;
  decodeCapabilities(items: unknown[]): Capabilities;
}
export interface ScanResult { sheets: number; images: number; warnings: string[] }
export interface ScannerDriver {
  readonly transport?: 'usb'|'network';
  readonly deviceIdentity?:ColorDeviceIdentity;
  readonly connected: boolean;
  readonly profile: ScannerProfile;
  readonly capabilities: Capabilities | undefined;
  validateOptions(options: ScanOptions): void;
  connect(): Promise<DeviceSettings>;
  settings(): Promise<DeviceSettings>;
  reset(): Promise<DeviceSettings>;
  disconnect(): Promise<void>;
  scan(options: ScanOptions, onImage: (image: CapturedImage) => Promise<void>, signal?: AbortSignal): Promise<ScanResult>;
}
export interface DriverContext {
  readonly usb: USB;
  readonly device: USBDevice;
  readonly profile: ScannerProfile;
  readonly log: (message: string) => void;
  readonly onDisconnect: () => void;
  readonly transferTimeout: number;
}
export interface DriverRegistration {
  readonly profile: ScannerProfile;
  readonly factory: (context: DriverContext) => ScannerDriver;
}
export interface DriverOptions {
  log?: (message: string) => void;
  onDisconnect?: () => void;
  transferTimeout?: number;
}
export function matchesDevice(profile: ScannerProfile, device: DeviceIdentity): boolean {
  return profile.devices.some(id => id.vendorId === device.vendorId && id.productId === device.productId);
}
