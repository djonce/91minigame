import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rename, copyFile, cp, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runtime = join(root, '.runtime/emulatorjs/4.2.3');
const source = join(root, '.runtime/upstream');
await mkdir(runtime, { recursive: true });
async function download(url, destination) {
  await mkdir(resolve(destination, '..'), { recursive: true });
  try { await access(destination); return; } catch {}
  console.log('Downloading', url);
  execFileSync('curl', ['-L', '--fail', '--retry', '2', '--max-time', '120', '-sS', url, '-o', destination + '.part'], { stdio: 'inherit' });
  await rename(destination + '.part', destination);
}
try { await access(join(source, 'data/loader.js')); } catch {
  const archive = join(root, '.runtime/emulatorjs-4.2.3.tar.gz');
  await download('https://codeload.github.com/EmulatorJS/EmulatorJS/tar.gz/refs/tags/v4.2.3', archive);
  await mkdir(source, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', source, '--strip-components=1']);
}
await cp(join(source, 'data'), join(runtime, 'data'), { recursive: true });
await copyFile(join(source, 'LICENSE'), join(runtime, 'LICENSE'));
for (const file of ['emulator.min.js', 'emulator.min.css', 'cores/fceumm-legacy-wasm.data', 'cores/reports/fceumm.json']) {
  await download(`https://cdn.emulatorjs.org/4.2.3/data/${file}`, join(runtime, 'data', file));
}
async function inventory(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await inventory(join(directory, entry.name), relativePath + '/'));
    else {
      const data = await readFile(join(directory, entry.name));
      files.push({ path: relativePath, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
const files = (await inventory(runtime)).filter(file => file.path !== 'manifest.json');
const core = files.find(file => file.path === 'data/cores/fceumm-legacy-wasm.data');
const manifest = {
  version: '4.2.3', core: 'fceumm', variant: 'legacy-single-thread',
  profileId: `ejs423-fceumm-${core.sha256.slice(0, 16)}`, coreSha256: core.sha256,
  source: 'https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3',
  generatedAt: new Date().toISOString(), files,
};
let existing;
try { existing = JSON.parse(await readFile(join(root, 'config/runtime-lock.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing) {
  for (const file of existing.files) {
    const actual = files.find(item => item.path === file.path);
    if (!actual || actual.size !== file.size || actual.sha256 !== file.sha256) throw new Error(`Runtime differs from committed lock: ${file.path}. Do not overwrite the lock; investigate or restore the pinned artifact.`);
  }
}
await writeFile(join(runtime, 'manifest.json'), JSON.stringify(existing || manifest, null, 2) + '\n');
await mkdir(join(root, 'config'), { recursive: true });
if (!existing) await writeFile(join(root, 'config/runtime-lock.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Ready: ${manifest.profileId}; ${files.length} files, ${files.reduce((n, f) => n + f.size, 0)} bytes`);
