/// <reference types="miniprogram-api-typings" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { NES, Controller } from '../miniprogram/native/vendor/core';
import { FrameClock, verifyRom, digest, parseSave, savePath, PROFILE, copyPixels } from '../miniprogram/native/session';
import { NativeControls } from '../miniprogram/native/controls';
import { NativeAudio } from '../miniprogram/native/audio';
import { playerLayout } from '../miniprogram/native/layout';
import { controllerRom } from './controller-rom';

test('native clock runs 60 emulated frames on 60 / 120 Hz displays and bounds catch-up', () => {
  for (const hz of [60, 120]) {
    const clock = new FrameClock(); clock.reset(0);
    let frames = 0;
    for (let tick = 1; tick <= hz * 10; tick++) frames += clock.advance(tick * 1000 / hz);
    assert.equal(frames, 600);
    assert.equal(clock.advance(25000), 3);
    clock.reset(30000);
    assert.equal(clock.advance(30001), 0);
  }
});

test('native multitouch keeps diagonal + A + B independent and clears cancellation', () => {
  const active = new Set<string>();
  let knob = [0, 0];
  const controls = new NativeControls((button, down) => down ? active.add(button) : active.delete(button), (x, y) => { knob = [x, y]; });
  const finger = (identifier: number, clientX = 240, clientY = 210) => ({ identifier, clientX, clientY });
  const box = { left: 100, top: 200, width: 150, height: 150 };
  controls.startStick([finger(1)], box);
  controls.press([finger(2)], 'a'); controls.press([finger(3)], 'b');
  assert.deepEqual(active, new Set(['up', 'right', 'a', 'b']));
  controls.end([finger(2)]);
  assert.deepEqual(active, new Set(['up', 'right', 'b']));
  controls.startStick([finger(4, 100, 350)], box); // a second finger cannot steal the stick
  assert.ok(active.has('up'));
  controls.moveStick([finger(1, 175, 275)], box);
  assert.deepEqual(active, new Set(['b']));
  controls.release(); assert.equal(active.size, 0); assert.deepEqual(knob, [0, 0]);
});

test('native layout stays inside phone viewports and gives landscape A/B at least 28px clearance', () => {
  const box = (style: string) => Object.fromEntries([...style.matchAll(/(left|top|width|height):(-?\d+)px/g)].map(m => [m[1], Number(m[2])])) as Record<string, number>;
  for (const [w, h] of [[296, 430], [351, 590], [369, 680], [654, 238], [732, 282], [828, 310]]) {
    const layout = playerLayout(w, h);
    for (const style of [layout.screen, layout.stick, layout.actions, layout.transport]) {
      const rect = box(style);
      assert.ok(rect.left >= 0 && rect.top >= 0 && rect.left + rect.width <= w + 1 && rect.top + rect.height <= h + 1, JSON.stringify({ w, h, rect }));
    }
    const screen = box(layout.screen), stick = box(layout.stick), actions = box(layout.actions);
    assert.ok(layout.wide ? stick.left + stick.width <= screen.left && screen.left + screen.width <= actions.left : screen.top + screen.height <= stick.top);
    if (layout.wide) assert.ok(actions.width - layout.actionSize * 2 >= 28);
  }
});

test('native ROM integrity, save namespaces and packed color conversion', () => {
  const rom = controllerRom(), sha256 = digest(rom);
  verifyRom(rom, { sha256, sizeBytes: rom.length });
  const changed = rom.slice(); changed[100] ^= 1;
  assert.throws(() => verifyRom(changed, { sha256, sizeBytes: rom.length }), /校验/);
  assert.throws(() => verifyRom(rom, { sha256, sizeBytes: 10 }), /大小/);
  assert.throws(() => savePath('../other'), /无效/);
  const nes = new NES({}); nes.loadROM(rom); nes.frame();
  const state = { version: 1, profile: PROFILE, romSha256: sha256, frame: 1, savedAt: Date.now(), state: nes.toJSON() };
  assert.equal(parseSave(JSON.stringify(state), sha256).frame, 1);
  assert.throws(() => parseSave(JSON.stringify({ ...state, profile: 'fceumm' }), sha256), /不匹配/);
  assert.throws(() => parseSave(JSON.stringify(state), 'b'.repeat(64)), /不匹配/);
  const frame = new Uint32Array(256 * 240), rgba = new Uint8ClampedArray(256 * 240 * 4);
  frame[0] = 0x123456; copyPixels(frame, rgba);
  assert.deepEqual([...rgba.slice(0, 4)], [0x56, 0x34, 0x12, 255]);
});

test('native core actually receives simultaneous controls through ROM controller ports', () => {
  const nes = new NES({}); nes.loadROM(controllerRom());
  const controls = new NativeControls((button, down) => {
    const id = ({ a: 0, b: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7 } as const)[button];
    if (down) nes.buttonDown(1, id); else nes.buttonUp(1, id);
  }, () => {});
  controls.press([{ identifier: 1, clientX: 0, clientY: 0 }], 'a');
  controls.press([{ identifier: 2, clientX: 0, clientY: 0 }], 'b');
  for (let i = 0; i < 5; i++) nes.frame();
  const cpu = () => nes.toJSON().cpu as { mem: number[] };
  assert.deepEqual(cpu().mem.slice(0x300, 0x308), [1, 1, 0, 0, 0, 0, 0, 0]);
  controls.end([{ identifier: 1, clientX: 0, clientY: 0 }]);
  for (let i = 0; i < 3; i++) nes.frame();
  assert.deepEqual(cpu().mem.slice(0x300, 0x302), [0, 1]);
  controls.release(); for (let i = 0; i < 3; i++) nes.frame();
  assert.deepEqual(cpu().mem.slice(0x300, 0x308), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('native audio clears scheduled blocks and cannot restart after a cancelled resume', async () => {
  let resolveResume: () => void = () => {};
  let started = 0, stopped = 0, closed = 0;
  const context = {
    state: 'running', currentTime: 0, destination: {},
    resume: () => new Promise<void>(resolve => { resolveResume = resolve; }),
    suspend: async () => {}, close: async () => { closed++; },
    createBuffer: (_: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() { started++; }, stop() { stopped++; }, buffer: null, onended: null }),
  };
  const globals = globalThis as typeof globalThis & { wx?: typeof wx };
  const previous = globals.wx;
  globals.wx = { createWebAudioContext: () => context } as unknown as typeof wx;
  try {
    const audio = new NativeAudio(() => assert.fail('unexpected audio error'));
    const pending = audio.resume(); audio.pause(); resolveResume(); assert.equal(await pending, false);
    for (let i = 0; i < 4096; i++) audio.push(.5, .5);
    assert.equal(started, 0);
    const resumed = audio.resume(); resolveResume(); assert.equal(await resumed, true);
    for (let i = 0; i < 4096; i++) audio.push(.5, .5);
    assert.equal(started, 2);
    audio.close(); assert.equal(stopped, 2); assert.equal(closed, 1);
  } finally { if (previous) globals.wx = previous; else delete globals.wx; }
});

const romPath = process.env.NATIVE_ROM_PATH || resolve(homedir(), 'Downloads/nes/赤色要塞.nes');
test('user original ROM boots, emits audio and restores a serialized gameplay state', { skip: !existsSync(romPath) }, () => {
  const bytes = readFileSync(romPath), original = digest(bytes);
  let lastFrame = new Uint32Array(), samples = 0, audible = false;
  const nes = new NES({ sampleRate: 44100, onFrame: frame => { lastFrame = frame.slice(); }, onAudioSample: (l, r) => { samples++; if (Math.abs(l) + Math.abs(r) > .001) audible = true; } });
  verifyRom(bytes, { sha256: original, sizeBytes: bytes.length });
  nes.loadROM(bytes); nes.setFramerate(60);
  for (let i = 0; i < 300; i++) nes.frame();
  nes.buttonDown(1, Controller.BUTTON_START); nes.frame(); nes.buttonUp(1, Controller.BUTTON_START);
  for (let i = 0; i < 180; i++) nes.frame();
  const state = JSON.stringify(nes.toJSON());
  const after = () => { for (let i = 0; i < 30; i++) nes.frame(); return digest(new Uint8Array(lastFrame.buffer)); };
  const expected = after(); nes.fromJSON(JSON.parse(state)); assert.equal(after(), expected);
  assert.ok(new Set(lastFrame).size > 8);
  assert.ok(samples > 300000 && audible);
  assert.equal(digest(readFileSync(romPath)), original, 'source ROM remains unchanged');
});
