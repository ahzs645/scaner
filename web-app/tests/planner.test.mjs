import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScanPlan, DEFAULT_OPTIONS, DEVICE_INPUT_RESOLUTIONS } from '../dist/planner.js';

// These expected bytes were generated once by the independent Python builder,
// not reconstructed by the TypeScript code under test. Keep fixtures frozen.
const fixtures = JSON.parse(await readFile(new URL('./profile-fixtures.json', import.meta.url), 'utf8'));
for (const fixture of fixtures.cases) {
  test(`Python payload/geometry parity: ${fixture.name}`, () => {
    const plan = buildScanPlan(fixture.options);
    assert.ok(plan.payload instanceof Uint8Array);
    assert.equal(Buffer.from(plan.payload).toString('hex'), fixture.payload_hex);
    assert.deepEqual(plan.summary, fixture.summary);
  });
}

test('default options match the frozen Python default case and cannot be mutated', () => {
  assert.deepEqual(DEFAULT_OPTIONS, fixtures.cases.find(fixture => fixture.name === 'color-default').options);
  assert.ok(Object.isFrozen(DEFAULT_OPTIONS));
  assert.throws(() => { DEFAULT_OPTIONS.quality = 1; }, TypeError);
  assert.deepEqual(DEVICE_INPUT_RESOLUTIONS, [50, 75, 100, 150, 200, 240, 300, 360, 400, 600]);
  assert.ok(Object.isFrozen(DEVICE_INPUT_RESOLUTIONS));
});

test('payload storage is independent between calls, protecting channel tables', () => {
  for (const mode of ['color', 'gray']) {
    const options = { ...DEFAULT_OPTIONS, mode };
    const first = buildScanPlan(options);
    const expected = Buffer.from(first.payload);
    first.payload.fill(0);
    first.summary.acquisition.width = 1;
    const second = buildScanPlan(options);
    assert.deepEqual(Buffer.from(second.payload), expected);
    assert.equal(second.summary.acquisition.width, 2544);
  }
});

test('rejects absent options and non-object carriers', () => {
  for (const options of [undefined, null, false, 0, '', [], {}]) {
    assert.throws(() => buildScanPlan(options), TypeError);
  }
});

test('rejects unsupported paper and mode values without object-key coercion', () => {
  for (const mode of ['lineart', '', null, 1, { toString: () => 'color' }]) {
    assert.throws(() => buildScanPlan({ ...DEFAULT_OPTIONS, mode }), TypeError);
  }
  for (const paper of ['Letter', 'a3', 'constructor', '__proto__', null, { toString: () => 'letter' }]) {
    assert.throws(() => buildScanPlan({ ...DEFAULT_OPTIONS, paper }), TypeError);
  }
});

test('requires actual booleans rather than coercing strings or numbers', () => {
  for (const field of ['duplex', 'deskew', 'auto_crop', 'double_feed']) {
    for (const value of [undefined, null, 0, 1, 'false', 'true', [], {}]) {
      assert.throws(() => buildScanPlan({ ...DEFAULT_OPTIONS, [field]: value }), TypeError, `${field}=${String(value)}`);
    }
  }
});

test('rejects numeric strings, non-finite values, floats and unsafe integers', () => {
  for (const field of ['dpi', 'max_sheets', 'quality']) {
    for (const value of ['300', undefined, null, NaN, Infinity, -Infinity, 1.5, true, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => buildScanPlan({ ...DEFAULT_OPTIONS, [field]: value }), TypeError, `${field}=${String(value)}`);
    }
  }
});

test('rejects unadvertised native DPI and host-interpolated resolutions', () => {
  for (const dpi of [0, 49, 301, 1200, 4800, 9600]) {
    assert.throws(() => buildScanPlan({ ...DEFAULT_OPTIONS, dpi }), RangeError);
  }
});

test('rejects crop outside advertised 300/600-dpi combinations', () => {
  for (const dpi of DEVICE_INPUT_RESOLUTIONS.filter(dpi => dpi !== 300 && dpi !== 600)) {
    assert.throws(() => buildScanPlan({ ...DEFAULT_OPTIONS, dpi, auto_crop: true }), /cropping at 300 or 600/);
  }
});

test('rejects sheet limits overflowing image-side count and invalid JPEG quality', () => {
  for (const [duplex, max_sheets] of [[false, -1], [true, -1], [false, 1000], [true, 500]]) {
    assert.throws(() => buildScanPlan({ ...DEFAULT_OPTIONS, duplex, max_sheets }), /three-digit image count/);
  }
  for (const quality of [-1, 0, 101]) {
    assert.throws(() => buildScanPlan({ ...DEFAULT_OPTIONS, quality }), /quality must be between 1 and 100/);
  }
});
