import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// JSNES 2.1.0, Apache-2.0. Replace only disjoint, in-bounds byte copies with
// TypedArray.set. Keep upstream semantics for object arrays and overlapping views.
export const memoryPatch = {
  name: 'jsnes-native-memory1',
  setup(build) {
    let applied = 0;
    build.onStart(() => { applied = 0; });
    build.onLoad({ filter: /[/\\]jsnes[/\\]src[/\\]utils\.js$/ }, async ({ path }) => {
      let source = await readFile(path, 'utf8');
      if (createHash('sha256').update(source).digest('hex') !== '3e97884bae801319ac802378ace60591f489dec533aec2e26663685ab08f378c') {
        throw new Error('JSNES utils changed; review the native memory patch.');
      }
      const signature = 'export function copyArrayElements(src, srcPos, dest, destPos, length) {';
      source = source.replace(signature, `${signature}
  // Pixel Playroom, 2026-09-20: native bulk copy for ROM/CHR byte banks.
  if (src instanceof Uint8Array && dest instanceof Uint8Array &&
      src.buffer !== dest.buffer && srcPos >= 0 && destPos >= 0 && length >= 0 &&
      srcPos + length <= src.length && destPos + length <= dest.length) {
    dest.set(src.subarray(srcPos, srcPos + length), destPos);
    return;
  }`);
      applied++;
      return { contents: source, loader: 'js' };
    });
    build.onEnd(({ errors }) => {
      if (!errors.length && applied !== 1) throw new Error('Native bundle must include the JSNES memory patch.');
    });
  },
};
