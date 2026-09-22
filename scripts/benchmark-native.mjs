import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { spritePatch } from './jsnes-sprite-patch.mjs';
import { memoryPatch } from './jsnes-memory-patch.mjs';

// Local-only benchmark. `node --jitless scripts/benchmark-native.mjs` measures
// interpreted JS pressure, not an iPhone or WeChat's native canvas/audio bridge.
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.local/native-benchmark');
await mkdir(output, { recursive: true });
const rom = await readFile(process.env.NATIVE_ROM_PATH || resolve(homedir(), 'Downloads/nes/赤色要塞.nes'));
const require = createRequire(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
await build({ entryPoints: [resolve(root, 'miniprogram/native/renderer.ts')], outfile: resolve(output, 'renderer.cjs'), bundle: true, platform: 'node', format: 'cjs' });
const { FrameBytes } = require(resolve(output, 'renderer.cjs'));
for (const optimized of [false, true]) {
  const name = optimized ? 'perf1' : 'sprites1';
  const target = resolve(output, `${name}.cjs`);
  await build({ entryPoints: [resolve(root, 'scripts/native-core-entry.ts')], outfile: target, bundle: true, minify: true,
    platform: 'browser', target: 'es2017', format: 'cjs', plugins: optimized ? [spritePatch, memoryPatch] : [spritePatch] });
  const { NES, Controller } = require(target);
  const audio = new Float64Array(2 * 1000 * 902), video = createHash('sha256');
  const rgba = new Uint8ClampedArray(256 * 240 * 4), upload = new FrameBytes();
  let frame, sample = 0;
  const nes = new NES({ sampleRate: 44100, onFrame: pixels => { frame = pixels; },
    onAudioSample: (l, r) => { audio[sample++] = l; audio[sample++] = r; } });
  nes.loadROM(rom); nes.setFramerate(60);
  const times = [];
  for (let i = 0; i < 901; i++) {
    if (i === 300) nes.buttonDown(1, Controller.BUTTON_START);
    if (i === 301) nes.buttonUp(1, Controller.BUTTON_START);
    if (i === 830) { nes.buttonDown(1, Controller.BUTTON_UP); nes.buttonDown(1, Controller.BUTTON_A); }
    if (i === 870) { nes.buttonUp(1, Controller.BUTTON_UP); nes.buttonUp(1, Controller.BUTTON_A); }
    const start = performance.now(); nes.frame();
    if (optimized) upload.get(frame);
    else for (let p = 0, pixel = 0; pixel < frame.length; pixel++, p += 4) {
      const color = frame[pixel]; rgba[p] = color & 255; rgba[p + 1] = (color >>> 8) & 255;
      rgba[p + 2] = (color >>> 16) & 255; rgba[p + 3] = 255;
    }
    if (i > 300) times.push(performance.now() - start);
    video.update(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
  }
  assert.ok(sample <= audio.length, 'audio capture must not overflow');
  times.sort((a, b) => a - b);
  const result = { name, frames: times.length, meanMs: times.reduce((a, b) => a + b) / times.length,
    p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)],
    videoSha256: video.digest('hex'), audioSha256: hash(new Uint8Array(audio.buffer, 0, sample * 8)),
    stateSha256: hash(JSON.stringify(nes.toJSON())) };
  results.push(result); console.log(JSON.stringify(result));
}
for (const key of ['videoSha256', 'audioSha256', 'stateSha256']) assert.equal(results[1][key], results[0][key], key);
const report = { flags: process.execArgv, note: 'Core + pixel preparation only; excludes native canvas/audio scheduling and setData.',
  reductionPercent: (1 - results[1].meanMs / results[0].meanMs) * 100, results };
await writeFile(resolve(output, 'result.json'), JSON.stringify(report, null, 2));
console.log(`Identical video, audio and state. CPU time reduced ${report.reductionPercent.toFixed(1)}%.`);
