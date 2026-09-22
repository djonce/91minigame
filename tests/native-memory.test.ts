import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

test('bulk memory patch preserves byte-bank, object-array and overlapping-copy semantics', async () => {
  const { memoryPatch } = await import(pathToFileURL(resolve('scripts/jsnes-memory-patch.mjs')).href);
  const result = await build({ entryPoints: ['node_modules/jsnes/src/utils.js'], bundle: true, write: false, format: 'cjs', plugins: [memoryPatch] });
  const module = { exports: {} as { copyArrayElements: (src: unknown, from: number, dest: unknown, to: number, count: number) => void } };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, Uint8Array });
  const copy = module.exports.copyArrayElements;
  const bank = Uint8Array.from({ length: 16384 }, (_, i) => i & 255), memory = new Uint8Array(65536);
  copy(bank, 0, memory, 0x8000, bank.length);
  assert.deepEqual(memory.slice(0x8000, 0xc000), bank);
  assert.equal(memory[0x7fff], 0); assert.equal(memory[0xc000], 0);
  const object = { tile: 1 }, list = [null, null];
  copy([object], 0, list, 1, 1); assert.equal(list[1], object);
  const overlapping = new Uint8Array([1, 2, 3, 4]);
  copy(overlapping.subarray(0, 3), 0, overlapping.subarray(1), 0, 3);
  assert.deepEqual([...overlapping], [1, 1, 1, 1], 'preserve the original forward copy on shared buffers');
  const short = new Uint8Array([5, 6]);
  copy(new Uint8Array([9]), 0, short, 0, 2);
  assert.deepEqual([...short], [9, 0], 'out-of-bounds source uses the original fallback');
});
