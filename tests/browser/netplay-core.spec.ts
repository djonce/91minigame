import { test, expect, type Browser } from '@playwright/test';
import { createHash } from 'node:crypto';
import { controllerRom, cpuRam } from '../controller-rom';
async function instance(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.route('**/core-probe.html', route => route.fulfill({ contentType: 'text/html', body: '<div id="emulator" style="width:256px;height:240px"></div>' }));
  await page.goto('/core-probe.html');
  return page;
}
test('core restores, replays identical inputs, and never advances while waiting for the network', async ({ browser }) => {
  const page = await instance(browser);
  const result = await page.evaluate(async () => {
    const modulePath = '/src/netplay/runtime.ts'; const { NetplayRuntime } = await import(modulePath);
    const r = new NetplayRuntime(); await r.prepare(await (await fetch('/api/games/nes-chise-yaosai')).json(), () => {});
    const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((n, i) => n === b[i]);
    const initial = r.capture();
    const run = async () => { for (let f = 0; f < 240; f++) await r.step([f < 120 ? 129 : 65, f % 20 < 10 ? 1 : 2, 0, 0]); };
    await run(); const first = r.capture();
    const frame = r.adapter.frame; await new Promise(resolve => setTimeout(resolve, 500)); const idle = r.adapter.frame === frame;
    await r.restore(initial, 0); const restored = equal(initial, r.capture());
    await run(); return { restored, replayed: equal(first, r.capture()), idle };
  });
  expect(result).toEqual({ restored: true, replayed: true, idle: true });
  await page.context().close();
});
test('Four Score diagnostic ROM sees three independent real controller ports', async ({ browser, request }) => {
  const bytes = controllerRom(); const hash = createHash('sha256').update(bytes).digest('hex');
  const base = await (await request.get('/api/games/nes-chise-yaosai')).json();
  const game = { ...base, id: 'controller-diagnostic', sha256: hash, sizeBytes: bytes.length, romUrl: `/controller-fixture.nes?sha=${hash}`, netplay: { players: 3, fps: 60.0988, controller: 'nes-four-score', validation: 'experimental' } };
  const page = await instance(browser);
  await page.route('**/controller-fixture.nes?*', route => route.fulfill({ contentType: 'application/octet-stream', body: Buffer.from(bytes) }));
  const states = await page.evaluate(async game => {
    const modulePath = '/src/netplay/runtime.ts'; const { NetplayRuntime } = await import(modulePath);
    const r = new NetplayRuntime(); await r.prepare(game, () => {});
    for (let frame = 0; frame < 10; frame++) await r.step([1, 2, 128, 0]);
    const first = Array.from(r.capture() as Uint8Array);
    for (let frame = 0; frame < 5; frame++) await r.step([0, 0, 1, 0]);
    return [first, Array.from(r.capture() as Uint8Array)];
  }, game);
  const ram = cpuRam(states[0]);
  expect(Array.from(ram.slice(0x300, 0x308))).toEqual([1,0,0,0,0,0,0,0]); // P1 A
  expect(Array.from(ram.slice(0x320, 0x328))).toEqual([0,1,0,0,0,0,0,0]); // P2 B
  expect(Array.from(ram.slice(0x308, 0x310))).toEqual([0,0,0,0,0,0,0,1]); // P3 Right
  expect(Array.from(cpuRam(states[1]).slice(0x308, 0x310))).toEqual([1,0,0,0,0,0,0,0]); // P3 A
  await page.context().close();
});
