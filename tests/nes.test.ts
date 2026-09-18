import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectNes } from '../shared/nes';
function rom() { const data = new Uint8Array(16 + 16384); data.set([0x4e, 0x45, 0x53, 0x1a, 1, 0]); return data; }
test('recognizes a standard NES image without mutating it', () => {
  const data = rom(); const before = data.slice(); const result = inspectNes(data);
  assert.equal(result.format, 'iNES'); assert.equal(result.mapperCandidate, 0); assert.equal(result.prgBytes, 16384); assert.deepEqual(data, before);
});
test('rejects invalid, truncated and oversize files', () => {
  assert.throws(() => inspectNes(new Uint8Array(32)), /ROM_INVALID/);
  assert.throws(() => inspectNes(rom().subarray(0, 1024)), /ROM_TRUNCATED/);
  const big = new Uint8Array(16 * 1024 * 1024 + 1); big.set(rom().subarray(0, 16)); assert.throws(() => inspectNes(big), /ROM_TOO_LARGE/);
});
test('accounts for trainer data and NES2 exponent encoding', () => {
  const trainer = rom(); trainer[6] = 4; assert.throws(() => inspectNes(trainer), /ROM_TRUNCATED/);
  const data = rom(); data[7] = 8; data[4] = 14 << 2; data[9] = 15;
  assert.equal(inspectNes(data).format, 'NES2'); assert.equal(inspectNes(data).prgBytes, 16384);
});
test('reports DiskDude contamination, distinguishing raw and candidate mapper', () => {
  const data = rom(); data[6] = 0x21; data.set(new TextEncoder().encode('DiskDude!'), 7);
  const result = inspectNes(data); assert.equal(result.mapperRaw, 66); assert.equal(result.mapperCandidate, 2); assert.deepEqual(result.warnings, ['DISKDUDE_HEADER']);
});
test('specified original sample retains its documented SHA-256', { skip: !process.env.TEST_ROM_PATH }, async () => {
  const data = await readFile(process.env.TEST_ROM_PATH!);
  assert.equal(createHash('sha256').update(data).digest('hex'), '98ed6d10391cccef249ce45cd935eb6263163f727fbf2fc11adb8116aa49f31d');
  assert.equal(inspectNes(data).mapperCandidate, 2);
});
