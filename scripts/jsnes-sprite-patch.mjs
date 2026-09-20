import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Local changes to JSNES 2.1.0 (Apache-2.0), 2026-09-20.
// 8x16 sprites select the pattern bank with bit 0 and the even tile with bits
// 1-7. Vertical flip reverses the full 16-row sprite exactly once, including
// sprite-zero hit detection. See docs/native-nes-validation.md.
const upstreamSha256 = 'b08bdebac1992572fc005d565af31bf907c14f8f8d66381ab1e3e6536cc12920';
export function patchSprites(source) {
  if (createHash('sha256').update(source).digest('hex') !== upstreamSha256) {
    throw new Error('JSNES PPU source changed; review the 8x16 sprite patch before rebuilding.');
  }
  const changes = [
    [
      'let top = (sprTile & 1) !== 0 ? topTileNum - 1 + 256 : topTileNum;',
      'let top = topTileNum + ((sprTile & 1) !== 0 ? 256 : 0);',
    ],
    [
      `        if (toffset < 8) {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 1 : 0) + ((sprTile & 1) !== 0 ? 255 : 0),
          );
        } else {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 0 : 1) + ((sprTile & 1) !== 0 ? 255 : 0),
          );
          toffset = vertFlip ? 15 - toffset : toffset - 8;
        }`,
      `        // toffset already includes the full 16-row vertical flip.
        let baseTile = (sprTile & 0xfe) + ((sprTile & 1) !== 0 ? 256 : 0);
        t = mmap.getSpritePatternTile(baseTile + (toffset >> 3));
        toffset &= 7;`,
    ],
    [
      `      if (sprRow < 8) {
        sprTileObj =
          this.ptTile[baseTileIdx + patternBase + (vertFlip ? 1 : 0)];
        toffset = sprRow * 8;
      } else {
        sprTileObj =
          this.ptTile[baseTileIdx + patternBase + (vertFlip ? 0 : 1)];
        toffset = (sprRow - 8) * 8;
      }`,
      `      // sprRow already includes the full 16-row vertical flip.
      sprTileObj = this.ptTile[baseTileIdx + patternBase + (sprRow >> 3)];
      toffset = (sprRow & 7) * 8;`,
    ],
  ];
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw new Error('JSNES sprite patch must match exactly once.');
    source = source.replace(before, after);
  }
  return `// Modified by Pixel Playroom: 8x16 sprite addressing/flip fixes, 2026-09-20.\n${source}`;
}

export const spritePatch = {
  name: 'jsnes-2.1.0-sprites1',
  setup(build) {
    let applied = 0;
    build.onStart(() => { applied = 0; });
    build.onLoad({ filter: /[/\\]jsnes[/\\]src[/\\]ppu[/\\]index\.js$/ }, async ({ path }) => {
      const contents = patchSprites(await readFile(path, 'utf8'));
      applied++;
      return { contents, loader: 'js' };
    });
    build.onEnd(({ errors }) => {
      if (!errors.length && applied !== 1) throw new Error('Native bundle must contain exactly one patched JSNES PPU.');
    });
  },
};
