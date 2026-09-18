import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const player = '/player.html?game=nes-chise-yaosai';
const digest = '98ed6d10391cccef249ce45cd935eb6263163f727fbf2fc11adb8116aa49f31d';
const frame = (page: Page) => page.evaluate(() => (window as any).EJS_emulator.gameManager.functions.getFrameNum());
async function stateHash(page: Page) {
  return page.evaluate(async () => {
    const bytes = new Uint8Array((window as any).EJS_emulator.gameManager.getState());
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
  });
}

test('deployed service runs original ROM and restores persistent saves', async ({ page, request, baseURL }, info) => {
  const errors: string[] = []; const external: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) external.push(req.url()); });
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true, mode: 'production', runtimeReady: true });
  const game = await (await request.get('/api/games/nes-chise-yaosai')).json();
  expect(game.sha256).toBe(digest);
  const rom = await request.get(game.romUrl);
  expect(rom.status()).toBe(200);
  expect(createHash('sha256').update(await rom.body()).digest('hex')).toBe(digest);
  for (const path of ['/src/player.ts', '/server/index.ts', '/.env', '/@vite/client', '/data/games.json']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  expect((await request.get('/api/roms/nes-chise-yaosai?sha=wrong')).status()).toBe(409);
  await page.goto('/');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await expect(page.locator('.game-card h3')).toHaveText('赤色要塞');
  await page.screenshot({ path: info.outputPath('library.png'), fullPage: true });
  await page.goto(player);
  await expect(page.locator('#launch')).toBeEnabled({ timeout: 70000 });
  await page.locator('#launch').click();
  await expect(page.locator('#play-status')).toHaveText('正在游玩');
  await expect.poll(() => frame(page)).toBeGreaterThan(50);
  await page.keyboard.press('Enter', { delay: 150 });
  const initialFrame = await frame(page);
  await expect.poll(() => frame(page), { timeout: 35000 }).toBeGreaterThan(initialFrame + 1200);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('KeyX');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyX');
  await page.keyboard.up('ArrowRight');
  expect(await page.evaluate(() => (window as any).EJS_emulator.Module.AL?.currentCtx?.audioCtx?.state)).toBe('running');
  await page.locator('#pause').click();
  await expect(page.locator('#play-status')).toHaveText('已暂停');
  const pausedFrame = await frame(page);
  await page.waitForTimeout(350);
  expect(await frame(page)).toBe(pausedFrame);
  await page.locator('#quick-save').click();
  await expect(page.locator('#toast')).toContainText('已保存到本机');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出快速存档', exact: true }).click();
  const exported = await download;
  const saved = JSON.parse(await readFile((await exported.path())!, 'utf8'));
  expect(saved.romSha256).toBe(digest);
  expect(createHash('sha256').update(Buffer.from(saved.stateBase64, 'base64')).digest('hex')).toBe(saved.stateSha256);
  expect(await stateHash(page)).toBe(saved.stateSha256);
  await page.locator('#resume').click();
  await expect.poll(() => frame(page)).toBeGreaterThan(pausedFrame + 60);
  await page.locator('#pause').click();
  expect(await stateHash(page)).not.toBe(saved.stateSha256);
  await page.locator('#quick-load').click();
  await expect(page.locator('#toast')).toContainText('已读取快速存档');
  expect(await stateHash(page)).toBe(saved.stateSha256);
  await page.setViewportSize({ width: 390, height: 844 });
  // Viewport fitting runs on the next animation frame after resize.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: info.outputPath('player-mobile.png'), fullPage: true });
  await page.goto('/#saves');
  await expect(page.locator('.save-row')).toHaveCount(1);
  await page.goto(player);
  await expect(page.locator('#launch')).toBeEnabled({ timeout: 70000 });
  await page.locator('#launch').click();
  await expect(page.locator('#play-status')).toHaveText('正在游玩');
  await page.locator('#pause').click();
  await page.locator('#quick-load').click();
  await expect(page.locator('#toast')).toContainText('已读取快速存档');
  expect(await stateHash(page)).toBe(saved.stateSha256);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
