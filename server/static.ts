import { readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep, extname } from 'node:path';

export const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
export interface StaticAsset { bytes: Buffer; etag: string; contentType: string; cacheControl: string }
// Snapshot only the built frontend at startup; source/data/env paths have no route.
export async function staticAssets(directory: string): Promise<Map<string, StaticAsset>> {
  const base = await realpath(directory);
  const result = new Map<string, StaticAsset>();
  async function walk(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const absolute = await realpath(resolve(path, entry.name));
      if (!absolute.startsWith(base + sep)) throw new Error('Static path escapes dist');
      const url = prefix + entry.name;
      if (entry.isDirectory()) { await walk(absolute, url + '/'); continue; }
      if (!entry.isFile() || !mime[extname(entry.name)]) continue;
      const bytes = await readFile(absolute);
      result.set(url, { bytes, etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
        contentType: mime[extname(entry.name)], cacheControl: url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    }
  }
  await walk(base, '/');
  if (!result.has('/index.html') || !result.has('/player.html')) throw new Error('Build the frontend before starting production server');
  result.set('/', result.get('/index.html')!);
  return result;
}
