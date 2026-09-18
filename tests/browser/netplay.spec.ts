import { test, expect, type Browser, type Page } from '@playwright/test';
async function participant(browser: Browser, code?: string, spectator = false, delayed = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 740 } });
  const page = await context.newPage();
  if (delayed) await page.routeWebSocket('**/netplay', route => {
    const server = route.connectToServer();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const forward = (send: (data: string | Buffer) => void) => {
      let due = 0, sequence = 0;
      const queue: { data: string | Buffer; due: number }[] = [];
      const pump = () => {
        if (!queue.length) return;
        const timer = setTimeout(() => { timers.delete(timer); send(queue.shift()!.data); pump(); }, Math.max(0, queue[0].due - Date.now())); timers.add(timer);
      };
      return (data: string | Buffer) => {
        // Ordered TCP delivery with 40–80 ms latency and jitter in each direction.
        due = Math.max(due + 1, Date.now() + 40 + (++sequence % 5) * 10);
        queue.push({ data, due }); if (queue.length === 1) pump();
      };
    };
    const clear = () => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
    route.onMessage(forward(data => server.send(data)));
    server.onMessage(forward(data => route.send(data)));
    route.onClose(() => { clear(); server.close(); });
    server.onClose(() => { clear(); route.close(); });
  });
  await page.addInitScript(() => {
    const original = WebSocket;
    (window as any).wireTypes = [];
    (window as any).testSockets = [];
    window.WebSocket = new Proxy(original, { construct(target, args) {
      const socket = new target(args[0], args[1]);
      if (String(args[0]).endsWith('/netplay')) {
        (window as any).testSockets.push(socket);
        const send = socket.send.bind(socket);
        socket.send = data => { (window as any).wireTypes.push(JSON.parse(String(data)).type); send(data); };
      }
      return socket;
    } });
    window.RTCPeerConnection = class { constructor() { throw new Error('Audio/video transport must not be used'); } } as any;
    HTMLCanvasElement.prototype.captureStream = () => { throw new Error('Canvas streaming must not be used'); };
  });
  await page.goto(`/netplay.html?game=nes-chise-yaosai${code ? `&room=${code}` : ''}`);
  if (code) { if (spectator) await page.locator('#spectator').check(); await page.locator('#join-room').click(); }
  else await page.locator('#create-room').click();
  await expect(page.locator('#ready')).toBeEnabled({ timeout: 70000 });
  await page.locator('#ready').click();
  await expect(page.locator('#ready')).toHaveText('已准备');
  return page;
}
async function hash(page: Page) {
  return page.evaluate(async () => {
    const e = (window as any).EJS_emulator;
    const state = e.gameManager.getState();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', state))).map(x => x.toString(16).padStart(2, '0')).join('');
  });
}
test('two real cores and a spectator exchange input only, pause consistently and resynchronize', async ({ browser }, info) => {
  test.setTimeout(180000);
  const owner = await participant(browser);
  const code = await owner.locator('#invite-code').innerText();
  const guest = await participant(browser, code);
  const spectator = await participant(browser, code, true);
  const pages = [owner, guest, spectator];
  const errors: string[] = [];
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
  }
  await owner.locator('#start-room').click();
  for (const page of pages) await expect(page.locator('#play-status')).toHaveText('正在联机');
  // The owner also reconnects and catches up committed inputs before supplying
  // the authoritative recovery snapshot. Its seat cannot migrate to another user.
  await owner.waitForTimeout(200);
  await owner.evaluate(() => (window as any).testSockets.at(-1).close());
  await expect(guest.locator('#play-status')).toHaveText('已暂停');
  await expect(owner.locator('#ready')).toBeEnabled(); await owner.locator('#ready').click();
  await expect(owner.locator('#seat-label')).toHaveText('1P');
  await owner.locator('#resume-room').click();
  for (const page of pages) await expect(page.locator('#play-status')).toHaveText('正在联机');
  await expect.poll(() => owner.locator('body').getAttribute('data-frame'), { timeout: 30000 }).toMatch(/\d{3,}/);
  await owner.locator('[data-input="select"]').click({ delay: 100 });
  await owner.locator('[data-input="start"]').click({ delay: 100 });
  await guest.locator('[data-input="a"]').click({ delay: 150 });
  await guest.locator('[data-input="right"]').click({ delay: 150 });
  await owner.waitForTimeout(3000);
  await owner.locator('#pause').click();
  for (const page of pages) await expect(page.locator('#play-status')).toHaveText('已暂停');
  const hashes = await Promise.all(pages.map(hash)); expect(new Set(hashes).size).toBe(1);
  const rawFrame = await owner.evaluate(() => (window as any).EJS_emulator.gameManager.functions.getFrameNum());
  await owner.waitForTimeout(500);
  expect(await owner.evaluate(() => (window as any).EJS_emulator.gameManager.functions.getFrameNum())).toBe(rawFrame);
  await owner.screenshot({ path: info.outputPath('netplay-room.png'), fullPage: true });
  await owner.locator('#resume-room').click();
  for (const page of pages) await expect(page.locator('#play-status')).toHaveText('正在联机');
  await expect(owner.locator('#room-error')).toBeHidden();
  // Guest input must reach P2 without taking over the owner's P1 controller.
  await guest.keyboard.down('ArrowRight'); await guest.keyboard.down('KeyX');
  await guest.waitForTimeout(400); await guest.keyboard.up('ArrowRight'); await guest.keyboard.up('KeyX');
  await guest.locator('#pause').click();
  for (const page of pages) await expect(page.locator('#play-status')).toHaveText('已暂停');
  expect(new Set(await Promise.all(pages.map(hash))).size).toBe(1);
  await owner.locator('#resume-room').click();
  await expect(owner.locator('#play-status')).toHaveText('正在联机');
  await owner.waitForTimeout(1500);
  await owner.screenshot({ path: info.outputPath('netplay-game.png'), fullPage: true });
  // Force a transport interruption while preserving this device's emulator.
  await guest.evaluate(() => (window as any).testSockets.at(-1).close());
  await expect(owner.locator('#play-status')).toHaveText('已暂停');
  await expect(guest.locator('#ready')).toBeEnabled(); await guest.locator('#ready').click();
  await expect(guest.locator('#seat-label')).toHaveText('2P');
  await owner.locator('#resume-room').click();
  for (const page of pages) await expect(page.locator('#play-status')).toHaveText('正在联机');
  expect(errors).toEqual([]);
  const channels = await owner.evaluate(() => ({ rtc: document.querySelectorAll('video,audio').length })); expect(channels.rtc).toBe(0);
  expect(await guest.evaluate(() => (window as any).wireTypes)).toContain('input');
  expect(await owner.evaluate(() => (window as any).wireTypes)).toContain('hash');
  await owner.locator('#pause').click(); await owner.locator('#leave-room').click();
  await expect(guest.locator('#play-status')).toHaveText('已结束');
  for (const page of pages) await page.context().close();
});

test('delayed and jittered input stays synchronized without streaming', async ({ browser }) => {
  test.setTimeout(180000);
  const owner = await participant(browser, undefined, false, true);
  const guest = await participant(browser, await owner.locator('#invite-code').innerText(), false, true);
  try {
    await owner.locator('#start-room').click();
    for (const page of [owner, guest]) await expect(page.locator('#play-status')).toHaveText('正在联机');
    await guest.keyboard.down('ArrowRight'); await owner.keyboard.down('KeyX');
    await expect.poll(async () => {
      const problem = await guest.locator('#room-error').innerText();
      if (problem) throw new Error(problem);
      return Number(await owner.locator('body').getAttribute('data-frame'));
    }, { timeout: 60000 }).toBeGreaterThanOrEqual(240);
    await guest.keyboard.up('ArrowRight'); await owner.keyboard.up('KeyX');
    await owner.locator('#pause').click();
    for (const page of [owner, guest]) await expect(page.locator('#play-status')).toHaveText('已暂停');
    expect(await hash(owner)).toBe(await hash(guest));
    await expect(owner.locator('#room-error')).toBeHidden(); await expect(guest.locator('#room-error')).toBeHidden();
  } finally { await owner.context().close(); await guest.context().close(); }
});
