import {matchesDevice} from './driver.js';
import type {DeviceIdentity, DriverOptions, DriverRegistration, ScannerDriver, ScannerProfile} from './driver.js';

/** Exact USB identities select factories; discovery never opens a device or
 * sends protocol probes to an unregistered model. */
export class ScannerRegistry {
  private registrations: DriverRegistration[] = [];
  constructor(private usb: USB, registrations: readonly DriverRegistration[] = [], private options: DriverOptions = {}) {
    for (const registration of registrations) this.register(registration);
  }
  get profiles(): readonly ScannerProfile[] { return this.registrations.map(entry => entry.profile); }
  register(registration: DriverRegistration): this {
    const {profile, factory} = registration;
    if (!profile.id.trim() || !profile.label.trim() || !profile.devices.length || typeof factory !== 'function') {
      throw Error('Invalid scanner registration');
    }
    if (this.registrations.some(entry => entry.profile.id === profile.id)) throw Error(`Duplicate scanner profile: ${profile.id}`);
    const identities = new Set<string>();
    for (const identity of profile.devices) {
      if (![identity.vendorId, identity.productId].every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)) {
        throw Error('Scanner USB IDs must be 16-bit integers');
      }
      const key = `${identity.vendorId}:${identity.productId}`;
      if (identities.has(key) || this.registrations.some(entry => matchesDevice(entry.profile, identity))) {
        throw Error(`Duplicate scanner USB identity: ${key}`);
      }
      identities.add(key);
    }
    // Snapshot match keys so caller mutation cannot widen the chooser or change
    // the identity associated with a previously registered factory.
    const snapshot = Object.freeze({...profile, devices: Object.freeze(profile.devices.map(id => Object.freeze({...id})))});
    this.registrations.push({profile: snapshot, factory});
    return this;
  }
  profileForDevice(device: DeviceIdentity): ScannerProfile | undefined {
    return this.registrations.find(entry => matchesDevice(entry.profile, device))?.profile;
  }
  createForDevice(device: USBDevice): ScannerDriver {
    const registration = this.registrations.find(entry => matchesDevice(entry.profile, device));
    if (!registration) throw Error(`Unsupported scanner USB device: ${device.vendorId.toString(16).padStart(4, '0')}:${device.productId.toString(16).padStart(4, '0')}`);
    return registration.factory({usb: this.usb, device, profile: registration.profile,
      log: this.options.log ?? (() => {}), onDisconnect: this.options.onDisconnect ?? (() => {}),
      transferTimeout: this.options.transferTimeout ?? 20000});
  }
  async chooseDriver(): Promise<ScannerDriver> {
    if (!this.registrations.length) throw Error('No supported scanner profiles are registered');
    const paired = (await this.usb.getDevices()).filter(device => !!this.profileForDevice(device));
    const device = paired.length === 1 ? paired[0]! : await this.usb.requestDevice({
      filters: this.registrations.flatMap(entry => entry.profile.devices.map(id => ({vendorId: id.vendorId, productId: id.productId}))),
    });
    return this.createForDevice(device);
  }
}
