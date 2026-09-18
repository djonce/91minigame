export interface SaveFile {
  format: 'pixel-room-save'; version: 1; romSha256: string; runtimeProfileId: string;
  stateSha256: string; stateBase64: string; exportedAt: string;
}
export function validateSaveFile(value: unknown, romSha256: string, runtimeProfileId: string): SaveFile {
  const v = value as Partial<SaveFile> | null;
  if (!v || v.format !== 'pixel-room-save' || v.version !== 1) throw new Error('这不是像素游乐室存档备份。');
  if (v.romSha256 !== romSha256 || v.runtimeProfileId !== runtimeProfileId) throw new Error('备份与当前 ROM 或模拟器版本不匹配，未覆盖已有存档。');
  if (typeof v.stateBase64 !== 'string' || !v.stateBase64.length || v.stateBase64.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.stateBase64) || v.stateBase64.length % 4 !== 0 || !/^[0-9a-f]{64}$/.test(v.stateSha256 || '')) throw new Error('备份内容格式有误。');
  return v as SaveFile;
}
