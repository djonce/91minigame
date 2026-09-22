/// <reference types="miniprogram-api-typings" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameBytes } from '../miniprogram/native/renderer';
import { copyPixels } from '../miniprogram/native/session';

test('GPU upload reuses the core frame without conversion and follows restored buffers', () => {
  const pixels = new Uint32Array(256 * 240 + 2).subarray(1, 256 * 240 + 1);
  pixels[0] = 0x123456;
  const upload = new FrameBytes(true), bytes = upload.get(pixels);
  assert.equal(bytes.buffer, pixels.buffer); assert.equal(bytes.byteOffset, pixels.byteOffset);
  assert.deepEqual([...bytes.slice(0, 4)], [0x56, 0x34, 0x12, 0]); // alpha is supplied by the shader
  pixels[0] = 0x654321; assert.equal(upload.get(pixels), bytes);
  assert.deepEqual([...bytes.slice(0, 3)], [0x21, 0x43, 0x65]);
  const restored = new Uint32Array(256 * 240); restored[0] = 0xffffff;
  assert.equal(upload.get(restored).buffer, restored.buffer);
  const portable = new FrameBytes(false).get(restored);
  assert.deepEqual([...portable.slice(0, 4)], [255, 255, 255, 255]);
});

test('2D fallback packed and unaligned copies keep every channel, alpha and buffer boundaries', () => {
  const pixels = Uint32Array.from({ length: 256 * 240 }, (_, i) => (i * 123457) & 0xffffff);
  for (const offset of [0, 1, 4]) {
    const storage = new Uint8ClampedArray(pixels.length * 4 + 8); storage.fill(0x77);
    const rgba = storage.subarray(offset, offset + pixels.length * 4);
    copyPixels(pixels, rgba);
    for (let i = 0; i < pixels.length; i++) {
      const color = pixels[i];
      assert.equal(rgba[i * 4], color & 255);
      assert.equal(rgba[i * 4 + 1], (color >> 8) & 255);
      assert.equal(rgba[i * 4 + 2], (color >> 16) & 255);
      assert.equal(rgba[i * 4 + 3], 255);
    }
    assert.ok(storage.slice(0, offset).every(value => value === 0x77));
    assert.ok(storage.slice(offset + pixels.length * 4).every(value => value === 0x77));
  }
});
