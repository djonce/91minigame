import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NES } from '../miniprogram/native/vendor/core';
import { controllerRom } from './controller-rom';

// Exercise the shipped core's PPU, not a duplicate renderer. All patterns below
// are original test data; no commercial ROM is needed for these regressions.
type Ppu = {
  f_spriteSize: number; f_spPatternTable: number;
  ptTile: { pix: Uint8Array }[];
  buffer: Uint32Array; pixrendered: Uint16Array; sprPalette: number[];
  scanlineSpriteCount: Uint8Array; scanlineSprite0: Uint8Array; scanlineSecondaryOAM: Uint8Array;
  spr0HitX: number; spr0HitY: number;
  nameTable: { tile: Uint8Array }[]; ntable1: number[];
  renderSpritesPartially(start: number, count: number, priority: number): void;
  checkSprite0(scan: number): boolean;
  _precomputeSprite0Hit(scan: number): boolean;
};
function fixture() {
  const nes = new NES({}); nes.loadROM(controllerRom());
  const ppu = (nes as unknown as { ppu: Ppu }).ppu;
  Object.assign(ppu, { f_spVisibility: 1, f_bgVisibility: 1, f_spClipping: 1, f_bgClipping: 1 });
  return ppu;
}
const pixel = (tile: number, x: number, y: number) => ((tile * 11) ^ (tile >> 8) ^ (y * 7) ^ (x * 5)) & 3;
function sprite(ppu: Ppu, tile: number, attr: number, height = 16) {
  ppu.scanlineSpriteCount.fill(0); ppu.scanlineSprite0.fill(0);
  for (let row = 0; row < height; row++) {
    const scan = 40 + row;
    ppu.scanlineSpriteCount[scan] = 1; ppu.scanlineSprite0[scan] = 1;
    ppu.scanlineSecondaryOAM.set([39, tile, attr, 32], scan * 32);
  }
}

test('native sprite pixels select both 8x16 pattern banks and flip complete sprites', () => {
  const ppu = fixture();
  for (let tile = 0; tile < 512; tile++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    ppu.ptTile[tile].pix[y * 8 + x] = pixel(tile, x, y);
  }
  for (let i = 0; i < 16; i++) ppu.sprPalette[i] = 0x102030 + i;
  for (const height of [8, 16]) for (const table of [0, 1]) {
    ppu.f_spriteSize = height === 16 ? 1 : 0; ppu.f_spPatternTable = table;
    for (const tile of [0, 1, 2, 3, 0x80, 0x81, 0xfe, 0xff]) for (const flip of [0, 0x40, 0x80, 0xc0]) for (const priority of [0, 1]) {
      sprite(ppu, tile, flip | (priority << 5) | 2, height);
      ppu.buffer.fill(0); ppu.pixrendered.fill(0xff);
      ppu.renderSpritesPartially(40, height, 1 - priority);
      assert.ok(ppu.buffer.every(p => p === 0), 'wrong priority pass must not draw the sprite');
      ppu.renderSpritesPartially(40, height, priority);
      for (let y = 0; y < height; y++) for (let x = 0; x < 8; x++) {
        const sx = flip & 0x40 ? 7 - x : x, sy = flip & 0x80 ? height - 1 - y : y;
        // Hardware 8x16 address: bit 0 selects the bank; the remaining bits
        // select an EVEN tile, followed by its odd partner. PPUCTRL is ignored.
        const address = height === 16 ? ((tile & 1) * 0x1000 + (tile & 0xfe) * 16 + Math.floor(sy / 8) * 16) : (table * 0x1000 + tile * 16);
        const value = pixel(address / 16, sx, sy % 8);
        assert.equal(ppu.buffer[(40 + y) * 256 + 32 + x], value ? ppu.sprPalette[8 + value] : 0,
          JSON.stringify({ height, table, tile, flip, priority, x, y }));
      }
      assert.equal(ppu.buffer[40 * 256 + 31], 0);
      assert.equal(ppu.buffer[(40 + height) * 256 + 32], 0);
    }
  }
});

test('8x16 sprite-zero hits follow the same flipped rows as visible pixels', () => {
  const ppu = fixture(); ppu.f_spriteSize = 1;
  Object.assign(ppu, { cntFV: 0, cntVT: 0, cntV: 0, regS: 0, regHT: 0, regH: 0, regFH: 0 });
  for (const name of ppu.nameTable) name.tile.fill(0x70);
  ppu.ntable1.fill(0);
  for (const tile of [2, 3]) for (const flip of [0, 0x40, 0x80, 0xc0]) {
    // Asymmetric pattern: only (1,2) and (6,13) are opaque in this 8x16 sprite.
    for (const pattern of ppu.ptTile) pattern.pix.fill(0);
    ppu.ptTile[0x70].pix.fill(1); // solid background
    const base = (tile & 1) * 256 + (tile & 0xfe);
    ppu.ptTile[base].pix[2 * 8 + 1] = 1;
    ppu.ptTile[base + 1].pix[5 * 8 + 6] = 1;
    sprite(ppu, tile, flip);
    ppu.pixrendered.fill(0x1ff); // an opaque background pixel at every position
    for (let row = 0; row < 16; row++) {
      const sourceY = flip & 0x80 ? 15 - row : row;
      const hit = sourceY === 2 || sourceY === 13;
      const sourceX = sourceY === 2 ? 1 : 6;
      const hitX = 32 + (flip & 0x40 ? 7 - sourceX : sourceX);
      const context = JSON.stringify({ tile, flip, row });
      assert.equal(ppu.checkSprite0(40 + row), hit, `sprite-zero overlap ${context}`);
      if (hit) assert.deepEqual([ppu.spr0HitX, ppu.spr0HitY], [hitX, 40 + row], context);
      assert.equal(ppu._precomputeSprite0Hit(40 + row), hit, `sprite-zero timing ${context}`);
      if (hit) assert.deepEqual([ppu.spr0HitX, ppu.spr0HitY], [hitX, 39 + row], context);
    }
  }
});
