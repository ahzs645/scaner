import test from 'node:test';
import assert from 'node:assert/strict';
import {ScannerRegistry} from '../dist/registry.js';
import {createDefaultRegistry, FF680W_PROFILE} from '../dist/profiles/index.js';
import {capabilities} from '../dist/capabilities.js';

const known = {vendorId: 0x04b8, productId: 0x016b};
function registration(id, vendorId, productId, calls) {
  const profile = {id, label: id, devices: [{vendorId, productId}],
    defaults: FF680W_PROFILE.defaults, decodeCapabilities: items => capabilities(items)};
  return {profile, factory: context => {calls.push(context); return {
    profile: context.profile, connected: false, capabilities: undefined, protocol: 'independent-test-protocol',
    validateOptions: () => {}, connect: async () => ({}), settings: async () => ({}),
    reset: async () => ({}), disconnect: async () => {},
    scan: async () => ({sheets:0,images:0,warnings:[]}),
  };}};
}
function usbRig(paired, selected) {
  const events = [];
  return {events, usb: {
    getDevices: async () => {events.push('paired'); return paired;},
    requestDevice: async options => {events.push(options); return selected;},
    addEventListener: () => {},
  }};
}

test('the default registry advertises only FF-680W and rejects unknown Epson models', () => {
  const mock = usbRig([], undefined), registry = createDefaultRegistry(mock.usb);
  assert.deepEqual(registry.profiles.map(p => p.id), ['epson-ff680w']);
  assert.equal(registry.profileForDevice(known).label, 'Epson FF-680W');
  for (const device of [{vendorId:0x04b8,productId:0x016c}, {vendorId:1,productId:0x016b}]) {
    assert.equal(registry.profileForDevice(device), undefined);
    assert.throws(() => registry.createForDevice(device), /Unsupported scanner/);
  }
  assert.deepEqual(mock.events, []);
});

test('discovery ignores unregistered paired devices and only constructs the matching factory', async () => {
  const calls = [], unknown = {vendorId:9,productId:9,open:()=>assert.fail('unknown opened')};
  const device = {vendorId:1,productId:2,open:()=>assert.fail('selection must not open hardware')};
  const mock = usbRig([unknown, device], undefined);
  const a = registration('a',1,2,calls), b = registration('b',3,4,calls);
  const registry = new ScannerRegistry(mock.usb,[a,b],{transferTimeout:123,log:()=>{},onDisconnect:()=>{}});
  const driver = await registry.chooseDriver();
  assert.equal(driver.protocol,'independent-test-protocol');
  assert.deepEqual(mock.events,['paired']);
  assert.equal(calls.length,1); assert.equal(calls[0].device,device);
  assert.equal(calls[0].profile.id,'a'); assert.equal(calls[0].transferTimeout,123);
});

test('empty or ambiguous matching pairings use only exact registered chooser filters', async () => {
  for (const paired of [[],[{vendorId:1,productId:2},{vendorId:3,productId:4}]]) {
    const calls = [], selected = {vendorId:3,productId:4}, mock = usbRig(paired,selected);
    const registry = new ScannerRegistry(mock.usb,[registration('a',1,2,calls),registration('b',3,4,calls)]);
    const driver = await registry.chooseDriver();
    assert.equal(driver.profile.id,'b');
    assert.deepEqual(mock.events,['paired',{filters:[{vendorId:1,productId:2},{vendorId:3,productId:4}]}]);
    assert.equal(calls.length,1);
  }
});

test('an unexpected chooser result is rejected without constructing or probing a driver', async () => {
  const calls=[],unknown={vendorId:9,productId:9,open:()=>assert.fail('unknown opened')},mock=usbRig([],unknown);
  const registry=new ScannerRegistry(mock.usb,[registration('a',1,2,calls)]);
  await assert.rejects(registry.chooseDriver(),/Unsupported scanner USB device: 0009:0009/);
  assert.deepEqual(calls,[]);
});

test('empty registries reject before invoking USB discovery', async () => {
  const mock=usbRig([],undefined),registry=new ScannerRegistry(mock.usb);
  await assert.rejects(registry.chooseDriver(),/No supported scanner profiles/);
  assert.deepEqual(mock.events,[]);
});

test('duplicate profile IDs and duplicate VID/PID identities reject registration atomically', () => {
  const mock=usbRig([],undefined),calls=[],registry=new ScannerRegistry(mock.usb,[registration('a',1,2,calls)]);
  assert.throws(()=>registry.register(registration('a',3,4,calls)),/Duplicate scanner profile/);
  assert.throws(()=>registry.register(registration('b',1,2,calls)),/Duplicate scanner USB identity/);
  const repeat=registration('c',3,4,calls); repeat.profile.devices.push({vendorId:3,productId:4});
  assert.throws(()=>registry.register(repeat),/Duplicate scanner USB identity/);
  assert.deepEqual(registry.profiles.map(p=>p.id),['a']);
  assert.equal(registry.profileForDevice({vendorId:3,productId:4}),undefined);
});

test('invalid and empty identity lists cannot become broad USB filters', () => {
  const registry=new ScannerRegistry(usbRig([],undefined).usb),calls=[];
  for(const identity of [{vendorId:-1,productId:2},{vendorId:1.5,productId:2},{vendorId:1,productId:65536}]) {
    assert.throws(()=>registry.register(registration('invalid',identity.vendorId,identity.productId,calls)),/16-bit integers/);
  }
  const empty=registration('empty',1,2,calls); empty.profile.devices=[];
  assert.throws(()=>registry.register(empty),/Invalid scanner registration/);
  assert.deepEqual(registry.profiles,[]);
});

test('registered identity snapshots cannot be widened by caller mutation', async () => {
  const calls=[],entry=registration('a',1,2,calls),mock=usbRig([],{vendorId:1,productId:2});
  const registry=new ScannerRegistry(mock.usb,[entry]);
  entry.profile.devices[0].productId=8;entry.profile.devices.push({vendorId:9,productId:9});
  assert.equal(registry.profileForDevice({vendorId:1,productId:2}).id,'a');
  assert.equal(registry.profileForDevice({vendorId:9,productId:9}),undefined);
  assert.throws(()=>registry.profiles[0].devices.push({vendorId:9,productId:9}),TypeError);
  await registry.chooseDriver();
  assert.deepEqual(mock.events[1],{filters:[{vendorId:1,productId:2}]});
});
