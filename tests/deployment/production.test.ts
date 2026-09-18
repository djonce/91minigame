import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

test('production serves built assets and registered ROMs without exposing source/data paths', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'pixel-room-deploy-'));
  const bytes = Buffer.alloc(16 + 16384); bytes.set([0x4e, 0x45, 0x53, 0x1a, 1, 0]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  await writeFile(resolve(directory, 'fixture.nes'), bytes);
  await writeFile(resolve(directory, 'games.json'), JSON.stringify([{ id: 'fixture', title: 'Deployment fixture', path: resolve(directory, 'fixture.nes') }]));
  await writeFile(resolve(directory, 'MP_verify_fixture123.txt'), 'fixture-verification-token');
  const child = spawn(process.execPath, ['build/server/index.js'], { env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', CATALOG_PATH: resolve(directory, 'games.json'), VERIFICATION_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stderr.on('data', bytes => { logs += bytes; });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Production startup timed out: ' + logs)), 10000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Production process exited: ' + logs)); });
      child.stdout.on('data', bytes => { logs += bytes; const match = logs.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    });
    const get = (path: string, options?: RequestInit) => fetch(origin + path, options);
    const health = await get('/api/health'); assert.equal(health.status, 200); assert.equal((await health.json()).mode, 'production');
    const page = await get('/'); const html = await page.text(); assert.match(html, /\/assets\/.+\.js/); assert.doesNotMatch(html, /@vite\/client|src\/library\.ts/);
    assert.equal((await get('/', { headers: { 'If-None-Match': page.headers.get('etag')! } })).status, 304);
    assert.equal((await get('/player.html', { method: 'HEAD' })).status, 200);
    for (const path of ['/.env', '/server/index.ts', '/src/player.ts', '/@vite/client', '/@fs/etc/passwd', '/.local/games.json', '/config/runtime-lock.json', '/data/games.json', '/runtime/emulatorjs/4.2.3/not-listed.js']) assert.equal((await get(path)).status, 404, path);
    assert.equal((await get('/', { method: 'POST' })).status, 405);
    assert.equal((await get('/api/roms/fixture?sha=wrong')).status, 409);
    assert.deepEqual(Buffer.from(await (await get(`/api/roms/fixture?sha=${sha}`)).arrayBuffer()), bytes);
    assert.equal((await get('/api/roms/missing?sha=x')).status, 404);
    const runtime = await get('/runtime/emulatorjs/4.2.3/data/loader.js'); assert.equal(runtime.status, 200);
    assert.equal((await get('/runtime/emulatorjs/4.2.3/data/loader.js', { headers: { 'If-None-Match': runtime.headers.get('etag')! } })).status, 304);
    assert.equal(await (await get('/MP_verify_fixture123.txt')).text(), 'fixture-verification-token');
    assert.equal((await get('/MP_verify_missing.txt')).status, 404);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
    await rm(directory, { recursive: true, force: true });
  }
});
