import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { controllerRom } from './controller-rom';
import { digest } from '../miniprogram/native/session';

// Exercise the actual page with a minimal WeChat host; simulator/device checks
// are still required for the native Canvas, touch delivery and audio output.
test('native page loads, pauses, saves, re-enters, restores and ignores a disposed download', async () => {
  const source = buildSync({ entryPoints: ['miniprogram/pages/native-nes/index.ts'], bundle: true, format: 'cjs', platform: 'browser', write: false }).outputFiles[0].text;
  const files = new Map<string, string>();
  const rom = controllerRom(), sha = digest(rom);
  let now = 0, drawn = 0, keepAwake = false;
  let pendingDownload: (() => void) | undefined;
  let holdDownload = false;
  let aborted = false;
  const callbacks = new Map<number, () => void>(); let nextId = 0;
  const pixels = new Uint8ClampedArray(256 * 240 * 4);
  const canvas = { width: 0, height: 0,
    getContext: () => ({ createImageData: () => ({ data: pixels }), putImageData: () => { drawn++; }, fillRect() {} }),
    requestAnimationFrame: (callback: () => void) => { callbacks.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
  };
  // The host surface is deliberately small and only implements APIs used here.
  const wx = {
    env: { USER_DATA_PATH: '/native-test' },
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 721, screenHeight: 844, screenWidth: 390, safeArea: { left: 0, right: 390, bottom: 810 } }),
    setKeepScreenOn: ({ keepScreenOn }: { keepScreenOn: boolean }) => { keepAwake = keepScreenOn; },
    showToast() {},
    getFileSystemManager: () => ({
      readFileSync: (path: string) => { if (!files.has(path)) throw new Error('not found'); return files.get(path); },
      writeFileSync: (path: string, text: string) => files.set(path, text),
      renameSync: (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); },
    }),
    request: (options: { url: string; success: (response: unknown) => void }) => {
      const finish = () => options.success({ statusCode: 200, data: options.url.includes('/api/roms/') ? rom.buffer : { id: 'test', title: 'Test NES', system: 'NES', sizeBytes: rom.length, sha256: sha } });
      if (options.url.includes('/api/roms/') && holdDownload) pendingDownload = finish; else queueMicrotask(finish);
      return { abort() { aborted = true; } };
    },
    createSelectorQuery: () => {
      let callback: ((box: unknown) => void) | undefined;
      const query = {
        select: () => query, fields: () => query,
        boundingClientRect: (value: (box: unknown) => void) => { callback = value; return query; },
        exec: (done?: (results: unknown[]) => void) => { callback?.({ left: 12, top: 400, width: 150, height: 150 }); done?.([{ node: canvas }]); },
      }; return query;
    },
  };
  function mount() {
    // Page's options are open-ended by design; this mock applies setData paths.
    let page: any;
    runInNewContext(source, { wx, console, setTimeout, clearTimeout, module: { exports: {} }, exports: {},
      Date: class extends Date { static now() { return now; } },
      Page: (definition: any) => { page = definition; },
    });
    page.setData = (data: Record<string, unknown>, done?: () => void) => {
      for (const [path, value] of Object.entries(data)) {
        const keys = path.split('.'); let target = page.data;
        for (const key of keys.slice(0, -1)) target = target[key];
        target[keys[keys.length - 1]] = value;
      } done?.();
    };
    page.onLoad({ id: 'test' }); page.onReady(); return page;
  }
  async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  function frame() { now += 1000 / 60; const list = [...callbacks.values()]; callbacks.clear(); list.forEach(callback => callback()); }
  const page = mount(); await settle();
  assert.equal(page.data.ready, true, page.data.error);
  page.data.sound = false; await page.start();
  for (let i = 0; i < 6; i++) frame();
  assert.ok(drawn > 0); assert.equal(keepAwake, true);
  page.buttonStart({ currentTarget: { dataset: { input: 'a' } }, changedTouches: [{ identifier: 1, clientX: 0, clientY: 0 }] });
  frame(); page.onHide();
  assert.equal(page.data.running, false); assert.equal(callbacks.size, 0); assert.equal(keepAwake, false);
  assert.equal(page.data.pressed.a, false);
  const pausedAt = page.runtime.frames;
  page.onShow(); assert.equal(page.runtime.frames, pausedAt); assert.equal(page.data.running, false);
  page.save(); assert.equal(page.data.hasSave, true); assert.equal(files.size, 1);
  page.onUnload(); assert.equal(callbacks.size, 0);
  const second = mount(); await settle();
  assert.equal(second.data.hasSave, true);
  second.restore(); assert.equal(second.runtime.frames, pausedAt); assert.equal(second.data.running, false);
  second.onUnload();
  holdDownload = true;
  const third = mount(); await settle();
  assert.ok(pendingDownload); third.onUnload(); pendingDownload!(); await settle();
  assert.equal(aborted, true); assert.equal(third.runtime.nes, undefined); assert.equal(callbacks.size, 0);
});
