import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium, expect, type Page } from '@playwright/test';
import { controllerRom, cpuRam } from '../controller-rom.js';

test('production room forwards three players into three real NES controller ports', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pixel-room-three-'));
  const rom = controllerRom(), sha256 = createHash('sha256').update(rom).digest('hex');
  const romPath = resolve(directory, 'fixture.nes');
  await writeFile(romPath, rom);
  await writeFile(resolve(directory, 'games.json'), JSON.stringify([{ id: 'three-player-fixture', title: 'Three controller diagnostic', path: romPath,
    netplay: { sha256, players: 3, controller: 'nes-four-score', fps: 60.0988 } }]));
  const child = spawn(process.execPath, ['build/server/index.js'], { env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', CATALOG_PATH: resolve(directory, 'games.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let logs = '';
  child.stderr.on('data', bytes => { logs += bytes; });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Startup timed out: ' + logs)), 10000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Server exited: ' + logs)); });
      child.stdout.on('data', bytes => { logs += bytes; const match = logs.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    });
    const pages: Page[] = [], errors: string[] = [];
    let code = '';
    for (let seat = 0; seat < 3; seat++) {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 740 } })).newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/netplay.html?game=three-player-fixture${code ? `&room=${code}` : ''}`);
      await page.locator(seat === 0 ? '#create-room' : '#join-room').click();
      await expect(page.locator('#ready')).toBeEnabled({ timeout: 45000 });
      await page.locator('#ready').click(); await expect(page.locator('#ready')).toHaveText('已准备');
      await expect(page.locator('#seat-label')).toHaveText(`${seat + 1}P`);
      code = await page.locator('#invite-code').innerText(); pages.push(page);
    }
    await pages[0].locator('#start-room').click();
    for (const page of pages) await expect(page.locator('#play-status')).toHaveText('正在联机');
    // Each seat gets a distinct button, checked inside the ROM's own CPU RAM.
    await pages[0].keyboard.down('KeyX'); await pages[1].keyboard.down('KeyZ'); await pages[2].keyboard.down('ArrowRight');
    await expect.poll(async () => Number(await pages[0].locator('body').getAttribute('data-frame')), { timeout: 15000 }).toBeGreaterThanOrEqual(180);
    await pages[0].keyboard.up('KeyX'); await pages[1].keyboard.up('KeyZ'); await pages[2].keyboard.up('ArrowRight');
    await pages[0].locator('#pause').click();
    for (const page of pages) await expect(page.locator('#play-status')).toHaveText('已暂停');
    const states = await Promise.all(pages.map(page => page.evaluate(() => Array.from((window as any).EJS_emulator.gameManager.getState()) as number[])));
    assert.deepEqual(states[0], states[1]); assert.deepEqual(states[1], states[2]);
    const ram = cpuRam(states[0]);
    assert.equal(ram[0x340], 1, 'P1 A must be read from the first controller');
    assert.equal(ram[0x361], 1, 'P2 B must be read from the second controller');
    assert.equal(ram[0x34f], 1, 'P3 Right must be read from the Four Score extension');
    for (const page of pages) await expect(page.locator('#room-error')).toBeHidden();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); child.kill('SIGTERM');
    await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
    await rm(directory, { recursive: true, force: true });
  }
});
