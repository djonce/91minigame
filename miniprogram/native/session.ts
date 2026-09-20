import { sha256, type NES } from './vendor/core';

export const PROFILE = 'jsnes-2.1.0-native-v1';
// Rendering patch preserves the v1 state format and existing quick saves.
export const CORE_BUILD = 'jsnes-2.1.0-sprites1';
export const FPS = 60;
export const SAMPLE_RATE = 44100;
export type NesState = ReturnType<NES['toJSON']>;
export function digest(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function verifyRom(bytes: Uint8Array, expected: { sha256: string; sizeBytes: number }) {
  if (bytes.length < 16 || bytes.length > 16 * 1024 * 1024 || bytes.length !== expected.sizeBytes) throw new Error('ROM 大小不符，请重新加载。');
  if (bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) throw new Error('文件不是 NES ROM。');
  if (digest(bytes) !== expected.sha256) throw new Error('ROM 校验失败，请重新加载。');
  // This first native profile deliberately excludes NES 2.0 / PAL and trainers.
  if ((bytes[7] & 12) === 8 || (bytes[6] & 4)) throw new Error('验证页暂不支持 NES 2.0 或带 Trainer 的 ROM。');
  const expectedLength = 16 + bytes[4] * 16384 + bytes[5] * 8192;
  if (!bytes[4] || expectedLength !== bytes.length) throw new Error('ROM 头部声明与文件长度不符。');
}
export interface NativeSave {
  version: 1; profile: string; romSha256: string; savedAt: number; frame: number; state: NesState;
}
export function savePath(romSha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(romSha256)) throw new Error('ROM 摘要无效。');
  return `${PROFILE}-${romSha256}.json`;
}
export function parseSave(text: string, romSha256: string): NativeSave {
  if (text.length > 6 * 1024 * 1024) throw new Error('存档过大。');
  const value = JSON.parse(text) as NativeSave;
  if (!value || value.version !== 1 || value.profile !== PROFILE || value.romSha256 !== romSha256 ||
      !Number.isSafeInteger(value.frame) || value.frame < 0 || !Number.isFinite(value.savedAt) ||
      !value.state || !(['cpu', 'mmap', 'ppu', 'papu'] as const).every(key => typeof value.state[key] === 'object' && value.state[key] !== null)) {
    throw new Error('存档与当前 ROM / 原生核心不匹配，或已损坏。');
  }
  return value;
}

// Bound catch-up after a slow frame; a 120 Hz display must not double game speed.
export class FrameClock {
  private last = 0;
  private remainder = 0;
  reset(now: number) { this.last = now; this.remainder = 0; }
  advance(now: number): number {
    this.remainder += Math.max(0, Math.min(100, now - this.last));
    this.last = now;
    const due = Math.floor((this.remainder + 0.00001) / (1000 / FPS));
    this.remainder -= due * (1000 / FPS);
    return Math.min(3, due);
  }
}

// JSNES emits BGR packed pixels; explicit bytes also work without endian assumptions.
export function copyPixels(frame: Uint32Array, rgba: Uint8ClampedArray) {
  for (let i = 0, p = 0; i < 256 * 240; i++, p += 4) {
    const color = frame[i];
    rgba[p] = color & 255; rgba[p + 1] = (color >>> 8) & 255;
    rgba[p + 2] = (color >>> 16) & 255; rgba[p + 3] = 255;
  }
}
