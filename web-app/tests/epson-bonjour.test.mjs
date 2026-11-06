import assert from 'node:assert/strict';
import test from 'node:test';
import {EpsonBrowse, scannerQuery} from '../dist/epson-bonjour.js';

const address = '192.168.77.19';
const host = 'EpsonExample.local';
const instance = 'EPSON FF-680W._scanner._tcp.local';
const id = 0x7319;
const name = value => Buffer.concat([...value.split('.').map(label => {
  const bytes = Buffer.from(label);
  return Buffer.concat([Buffer.of(bytes.length), bytes]);
}), Buffer.of(0)]);

function resource(owner, type, data, ttl = 10) {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(1, 2);
  header.writeUInt32BE(ttl, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([name(owner), header, data]);
}

function reply(...resources) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(resources.length, 6);
  return Buffer.concat([header, ...resources]);
}

const ptr = ttl => resource('_scanner._tcp.local', 12, name(instance), ttl);
const srv = resource(instance, 33, Buffer.concat([Buffer.from([0, 0, 0, 0, 0x07, 0x49]), name(host)]));
const a = resource(host, 1, Buffer.from(address.split('.').map(Number)));
const txt = resource(instance, 16, Buffer.concat(['mfg=EPSON', 'mdl=FF-680W', 'scannerAvailable=0']
  .map(value => Buffer.concat([Buffer.of(value.length), Buffer.from(value)]))));

test('Bonjour uses a PTR query and resolves an Epson across correlated replies', () => {
  assert.equal(Buffer.from(scannerQuery(id)).toString('hex'),
    '731900000001000000000000085f7363616e6e6572045f746370056c6f63616c00000c0001');
  const discovery = new EpsonBrowse(id);
  discovery.accept(reply(ptr(), srv), address, 5353, 0);
  assert.deepEqual(discovery.targets(1), []);
  discovery.accept(reply(a, txt), address, 5353, 1);
  const [found] = discovery.targets(2);
  assert.equal(found.address, address);
  assert.equal(found.target.host, host);
  assert.equal(found.target.port, 1865);
  assert.equal(found.target.available, false);
  assert.deepEqual(discovery.targets(10000), []);
});

test('Bonjour ignores unrelated sources and malformed packets, and handles goodbye records', () => {
  const discovery = new EpsonBrowse(id), complete = reply(ptr(), srv, a, txt);
  discovery.accept(complete, '192.168.77.20', 5353, 0);
  discovery.accept(complete, address, 1111, 0);
  discovery.accept(complete.subarray(0, -1), address, 5353, 0);
  const badPointer = Buffer.from(complete);
  badPointer.set([0xc0, 12], 12); // self-referential name
  discovery.accept(badPointer, address, 5353, 0);
  assert.deepEqual(discovery.targets(1), []);
  discovery.accept(complete, address, 5353, 1);
  discovery.accept(complete, address, 5353, 2);
  assert.equal(discovery.targets(3).length, 1);
  discovery.accept(reply(ptr(0)), address, 5353, 4);
  assert.deepEqual(discovery.targets(5), []);
});
