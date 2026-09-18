import type { RomInspection } from './types.js';

export function inspectNes(bytes: Uint8Array): RomInspection {
  if (bytes.length < 16 || bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
    throw new Error('ROM_INVALID：文件不是有效的 NES 镜像');
  }
  if (bytes.length > 16 * 1024 * 1024) throw new Error('ROM_TOO_LARGE：首期支持最大 16 MiB 的 NES 文件');
  const nes2 = (bytes[7] & 0x0c) === 0x08;
  const diskDude = String.fromCharCode(...bytes.subarray(7, 16)) === 'DiskDude!';
  const archaic = !nes2 && ((bytes[7] & 0x0c) !== 0 || bytes.subarray(12, 16).some(Boolean));
  const length = (lsb: number, msb: number, unit: number): number => {
    if (msb === 15) return 2 ** (lsb >> 2) * ((lsb & 3) * 2 + 1);
    return ((msb << 8) | lsb) * unit;
  };
  const prgBytes = nes2 ? length(bytes[4], bytes[9] & 15, 16384) : (bytes[4] || 256) * 16384;
  const chrBytes = nes2 ? length(bytes[5], bytes[9] >> 4, 8192) : bytes[5] * 8192;
  const trainer = Boolean(bytes[6] & 4);
  const expected = 16 + (trainer ? 512 : 0) + prgBytes + chrBytes;
  if (!Number.isSafeInteger(expected) || expected > bytes.length) throw new Error('ROM_TRUNCATED：ROM 内容少于文件头声明的长度');
  const mapperRaw = (bytes[6] >> 4) | (bytes[7] & 0xf0) | (nes2 ? ((bytes[8] & 15) << 8) : 0);
  const warnings: string[] = [];
  if (diskDude) warnings.push('DISKDUDE_HEADER');
  else if (archaic) warnings.push('ARCHAIC_HEADER');
  if (bytes.length !== expected) warnings.push('TRAILING_DATA');
  return {
    format: nes2 ? 'NES2' : archaic ? 'archaic-iNES' : 'iNES',
    sizeBytes: bytes.length, prgBytes, chrBytes, mapperRaw,
    mapperCandidate: archaic ? bytes[6] >> 4 : mapperRaw,
    trainer, battery: Boolean(bytes[6] & 2), warnings,
  };
}
