import type { Game, SaveRecord, SaveSlot } from '../shared/types';
let connection: Promise<IDBDatabase> | undefined;
function db() {
  return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pixel-room-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('saves', { keyPath: 'key' });
      request.result.createObjectStore('roms', { keyPath: 'sha256' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法使用本地存储，请检查浏览器隐私或存储设置。'));
  });
}
async function write(store: string, value: unknown) {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('本地保存失败，可能存储空间不足。请导出已有存档后重试。'));
  });
}
async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(bytes).buffer;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export const saveKey = (game: Pick<Game, 'sha256' | 'runtimeProfileId'>, slot: SaveSlot) => `${game.sha256}:${game.runtimeProfileId}:${slot}`;
export async function putSave(game: Game, slot: SaveSlot, state: Uint8Array, screenshot?: Blob): Promise<SaveRecord> {
  if (!state.length || state.length > 8 * 1024 * 1024) throw new Error('存档长度异常，未写入。');
  const record: SaveRecord = {
    key: saveKey(game, slot), gameId: game.id, title: game.title, romSha256: game.sha256,
    runtimeProfileId: game.runtimeProfileId, slot, updatedAt: Date.now(),
    state: new Uint8Array(state), stateSha256: await sha256(state), screenshot,
  };
  await write('saves', record);
  return record;
}
export async function getSave(game: Game, slot: SaveSlot): Promise<SaveRecord | undefined> {
  const record = await get<SaveRecord>('saves', saveKey(game, slot));
  if (record && (record.romSha256 !== game.sha256 || record.runtimeProfileId !== game.runtimeProfileId || await sha256(record.state) !== record.stateSha256)) {
    throw new Error('存档版本不匹配或内容损坏，已保留原存档。');
  }
  return record;
}
export async function listSaves(): Promise<SaveRecord[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('saves').objectStore('saves').getAll();
    request.onsuccess = () => resolve(request.result.sort((a: SaveRecord, b: SaveRecord) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
  });
}
export async function loadRom(game: Game, signal: AbortSignal, progress: (message: string) => void): Promise<Uint8Array> {
  try {
    const cached = await get<{ sha256: string; bytes: Uint8Array }>('roms', game.sha256);
    if (cached && await sha256(cached.bytes) === game.sha256) { progress('已从本机缓存读取卡带'); return cached.bytes; }
  } catch { /* Storage may be unavailable; downloading still works. */ }
  progress('正在读取游戏文件…');
  const response = await fetch(game.romUrl, { signal });
  if (!response.ok) throw new Error(response.status === 409 ? 'ROM 已更换，请返回游戏库重新打开。' : 'ROM 下载失败，请检查网络后重试。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== game.sizeBytes || await sha256(bytes) !== game.sha256) throw new Error('ROM 校验失败，已停止加载。请重试。');
  try { await write('roms', { sha256: game.sha256, bytes }); } catch { progress('卡带已读取，本次无法缓存'); }
  return bytes;
}
export async function clearRomCache() {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('roms', 'readwrite');
    tx.objectStore('roms').clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
