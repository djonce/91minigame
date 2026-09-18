import { readFile, stat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { inspectNes } from '../shared/nes.js';
import type { Game, RuntimeManifest } from '../shared/types.js';

export const root = resolve(process.env.APP_ROOT || process.cwd());
export const runtimeRoot = resolve(root, '.runtime/emulatorjs/4.2.3');
const catalogPath = resolve(process.env.CATALOG_PATH || resolve(root, '.local/games.json'));
export async function runtimeManifest(): Promise<RuntimeManifest | null> {
  try {
    const manifest: RuntimeManifest = JSON.parse(await readFile(resolve(root, 'config/runtime-lock.json'), 'utf8'));
    await Promise.all(manifest.files.map(async file => { if ((await stat(resolve(runtimeRoot, file.path))).size !== file.size) throw new Error('Runtime file size mismatch'); }));
    return manifest;
  }
  catch { return null; }
}
export interface LocalEntry { id: string; title: string; path: string }
export async function entries(): Promise<LocalEntry[]> {
  try {
    const value: unknown = JSON.parse(await readFile(catalogPath, 'utf8'));
    if (!Array.isArray(value) || value.length > 100 || value.some(entry => !entry || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) || typeof entry.title !== 'string' || typeof entry.path !== 'string') || new Set(value.map(entry => entry.id)).size !== value.length) throw new Error('Invalid .local/games.json: use unique IDs and a maximum of 100 entries.');
    return value;
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (process.env.NODE_ENV === 'production') return [];
    return [{ id: 'nes-chise-yaosai', title: '赤色要塞', path: process.env.ROM_PATH || resolve(homedir(), 'Downloads/nes/赤色要塞.nes') }];
  }
}
export async function loadGame(entry: LocalEntry, runtime: RuntimeManifest | null): Promise<{ game: Game; bytes: Buffer }> {
  if ((await stat(entry.path)).size > 16 * 1024 * 1024) throw new Error('ROM_TOO_LARGE');
  const bytes = await readFile(entry.path);
  const inspection = inspectNes(bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, game: {
    id: entry.id, title: entry.title || basename(entry.path, '.nes'), system: 'NES',
    description: '插入熟悉的卡带，回到纯粹的游玩时光。', sha256, sizeBytes: bytes.length, inspection,
    romUrl: `/api/roms/${encodeURIComponent(entry.id)}?sha=${sha256}`,
    runtimeProfileId: runtime?.profileId || 'runtime-not-installed', available: Boolean(runtime),
  } };
}
