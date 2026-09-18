import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSaveFile } from '../shared/save-file';
const backup = { format: 'pixel-room-save', version: 1, romSha256: 'a'.repeat(64), runtimeProfileId: 'runtime-1', stateSha256: 'b'.repeat(64), stateBase64: 'AQID', exportedAt: '2026-09-15' };
test('accepts compatible backups and blocks cross-ROM or cross-core imports', () => {
  assert.equal(validateSaveFile(backup, backup.romSha256, 'runtime-1'), backup);
  assert.throws(() => validateSaveFile(backup, 'c'.repeat(64), 'runtime-1'), /不匹配/);
  assert.throws(() => validateSaveFile(backup, backup.romSha256, 'runtime-2'), /不匹配/);
});
test('rejects unknown formats and invalid binary payload encoding', () => {
  for (const value of [null, {}, { ...backup, version: 2 }]) assert.throws(() => validateSaveFile(value, backup.romSha256, 'runtime-1'));
  for (const stateBase64 of ['', '@@==', 'abc', 'a'.repeat(12 * 1024 * 1024 + 1)]) assert.throws(() => validateSaveFile({ ...backup, stateBase64 }, backup.romSha256, 'runtime-1'), /格式/);
});
