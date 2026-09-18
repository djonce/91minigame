import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'config/runtime-lock.json'), 'utf8'));
for (const file of manifest.files) {
  const data = await readFile(resolve(root, '.runtime/emulatorjs/4.2.3', file.path));
  if (data.length !== file.size || createHash('sha256').update(data).digest('hex') !== file.sha256) {
    throw new Error(`Runtime integrity mismatch: ${file.path}`);
  }
}
console.log(`Verified ${manifest.files.length} runtime files: ${manifest.profileId}`);
