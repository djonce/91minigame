import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spritePatch } from './jsnes-sprite-patch.mjs';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'miniprogram/native/vendor');
await mkdir(output, { recursive: true });
const { version } = JSON.parse(await readFile(resolve(root, 'node_modules/jsnes/package.json'), 'utf8'));
if (version !== '2.1.0') throw new Error('Native NES profile requires JSNES 2.1.0');
await build({
  entryPoints: [resolve(root, 'scripts/native-core-entry.ts')], outfile: resolve(output, 'core.js'),
  bundle: true, format: 'iife', globalName: 'NativeNesCore', platform: 'browser', target: 'es2017', minify: true,
  plugins: [spritePatch],
  footer: { js: ['NES', 'Controller', 'sha256', 'directionAt', 'InputSources'].map(name => `module.exports.${name} = NativeNesCore.${name};`).join('\n') },
  legalComments: 'inline', banner: { js: '/* JSNES 2.1.0 (Apache-2.0), modified 2026-09-20: 8x16 sprite fixes (scripts/jsnes-sprite-patch.mjs). @noble/hashes 1.8.0 (MIT). See adjacent licenses. */' },
});
await copyFile(resolve(root, 'node_modules/jsnes/LICENSE'), resolve(output, 'JSNES-LICENSE.txt'));
await copyFile(resolve(root, 'node_modules/@noble/hashes/LICENSE'), resolve(output, 'HASHES-LICENSE.txt'));
console.log('Native NES core bundled (JSNES 2.1.0 + sprites1).');
