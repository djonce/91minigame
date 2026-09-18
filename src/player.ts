import './style.css';
import type { Game, SaveRecord, SaveSlot } from '../shared/types';
import { validateSaveFile, type SaveFile } from '../shared/save-file';
import { getSave, putSave, sha256 } from './storage';
import { RuntimeAdapter } from './runtime-adapter';
import { bindGamepad } from './gamepad';
import { bindPlayerLayout, readPreferences, writePreferences } from './player-layout';
import { dateLabel, downloadJson, el, toast } from './ui';
const runtime = new RuntimeAdapter();
const slots: SaveSlot[] = ['quick', 'manual-1', 'manual-2', 'manual-3'];
const names: Record<SaveSlot, string> = { quick: '快速存档', 'manual-1': '存档 01', 'manual-2': '存档 02', 'manual-3': '存档 03' };
const params = new URLSearchParams(location.search);
const requestedSlot = slots.find(slot => slot === params.get('slot'));
let game: Game;
let records = new Map<SaveSlot, SaveRecord>();
let started = false;
let busy = false;
let menuOpen = false;
let interrupted = false;
const preferences = readPreferences();
document.body.dataset.embedded = String(params.get('source') === 'wechat');
const imageUrls: string[] = [];
const still = document.createElement('img'); still.id = 'paused-frame'; still.alt = '暂停时的游戏画面'; still.hidden = true;
el('paused-overlay').before(still);
let stillUrl: string | undefined;
let stillGeneration = 0;
function showStill(blob: Blob) {
  if (stillUrl) URL.revokeObjectURL(stillUrl);
  still.src = stillUrl = URL.createObjectURL(blob); still.hidden = false;
}
function update() {
  el('play-status').textContent = started ? (runtime.paused ? '已暂停' : '正在游玩') : '准备就绪';
  el('pause').textContent = runtime.paused && started ? 'Ⅱ 已暂停' : 'Ⅱ 菜单';
  el('paused-overlay').hidden = !started || !runtime.paused;
  if (!runtime.paused || !started) { still.hidden = true; ++stillGeneration; }
  for (const id of ['pause', 'resume', 'quick-save', 'mute', 'restart', 'import-save']) el<HTMLButtonElement>(id).disabled = !started || busy;
  el<HTMLButtonElement>('quick-load').disabled = !started || busy || !records.has('quick');
  document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => { button.disabled = !started || busy || (button.dataset.action !== 'save' && !records.has(button.dataset.slot as SaveSlot)); });
}
function releaseInputs() {
  gamepad.release(); runtime.releaseAll();
}
function openMenu(focus = true) {
  if (!started) return;
  menuOpen = true; pause();
  el('pause-menu').hidden = false;
  el('player-workspace').inert = true;
  el('player-workspace').setAttribute('aria-hidden', 'true');
  el('pause').setAttribute('aria-expanded', 'true');
  if (focus) el('resume').focus();
}
function resumeGame() {
  if (!started || busy) return;
  menuOpen = false; interrupted = false;
  el('pause-menu').hidden = true;
  el('player-workspace').inert = false;
  el('player-workspace').removeAttribute('aria-hidden');
  el('pause').setAttribute('aria-expanded', 'false');
  releaseInputs(); runtime.resume(); update(); el('pause').focus();
}
function pause() {
  releaseInputs(); runtime.pause(); update();
  if (!started) return;
  const generation = ++stillGeneration;
  void runtime.screenshot().then(blob => { if (blob && runtime.paused && generation === stillGeneration) showStill(blob); }).catch(() => { /* Pausing must still work without a thumbnail. */ });
}
async function exclusive(work: () => Promise<void>, freeze = true) {
  if (busy || !started) return;
  busy = true;
  const wasPlaying = !runtime.paused;
  if (freeze) pause();
  update();
  try { await work(); } catch (error) { toast(error instanceof Error ? error.message : '操作失败，请重试。', true); }
  finally { busy = false; if (freeze && wasPlaying && !document.hidden && !menuOpen && !interrupted) runtime.resume(); update(); }
}
async function refreshSlots() {
  const results = await Promise.all(slots.map(async slot => [slot, await getSave(game, slot)] as const));
  records = new Map(results.filter((entry): entry is readonly [SaveSlot, SaveRecord] => Boolean(entry[1])));
  imageUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
  el('slots').replaceChildren(...slots.map((slot, index) => {
    const record = records.get(slot);
    const card = document.createElement('div'); card.className = 'save-slot';
    const title = document.createElement('div'); title.className = 'slot-title';
    title.innerHTML = `<span class="slot-number">${index === 0 ? '↯' : String(index).padStart(2, '0')}</span> ${names[slot]}`; card.append(title);
    if (record?.screenshot) { const img = new Image(); img.className = 'slot-thumbnail'; img.alt = `${names[slot]}画面`; img.src = URL.createObjectURL(record.screenshot); imageUrls.push(img.src); card.append(img); }
    const time = document.createElement('p'); time.className = 'slot-time'; time.textContent = record ? dateLabel(record.updatedAt) : '空白，等一个好时刻。'; card.append(time);
    const actions = document.createElement('div'); actions.className = 'slot-actions';
    for (const [action, label] of [['save', '保存'], ['load', '读取'], ['export', '导出']]) {
      const button = document.createElement('button'); button.dataset.slot = slot; button.dataset.action = action; button.textContent = label; button.setAttribute('aria-label', `${label}${names[slot]}`); actions.append(button);
    }
    card.append(actions); return card;
  }));
  update();
}
async function save(slot: SaveSlot) {
  if (records.has(slot) && slot !== 'quick' && !confirm(`覆盖${names[slot]}？`)) return;
  const state = runtime.capture();
  const screenshot = await runtime.screenshot();
  await putSave(game, slot, state, screenshot);
  await refreshSlots(); toast(`${names[slot]}已保存到本机。`);
}
async function restore(slot: SaveSlot) {
  const record = await getSave(game, slot);
  if (!record) throw new Error('这个位置还没有存档。');
  await runtime.restore(record.state);
  ++stillGeneration;
  if (record.screenshot && runtime.paused) showStill(record.screenshot);
  toast(`已读取${names[slot]}。`);
}
async function exportSave(slot: SaveSlot) {
  const record = await getSave(game, slot);
  if (!record) throw new Error('还没有可导出的存档。');
  let binary = '';
  for (let i = 0; i < record.state.length; i += 8192) binary += String.fromCharCode(...record.state.subarray(i, i + 8192));
  const output: SaveFile = { format: 'pixel-room-save', version: 1, romSha256: game.sha256, runtimeProfileId: game.runtimeProfileId, stateSha256: record.stateSha256, stateBase64: btoa(binary), exportedAt: new Date().toISOString() };
  downloadJson(output, `${game.id}-${slot}.json`);
  toast('存档备份已导出。');
}
el('slots').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-slot]');
  if (!button) return;
  const slot = button.dataset.slot as SaveSlot;
  void exclusive(() => button.dataset.action === 'save' ? save(slot) : button.dataset.action === 'load' ? restore(slot) : exportSave(slot));
});
el('pause').addEventListener('click', () => openMenu());
el('resume').addEventListener('click', resumeGame);
el('quick-save').addEventListener('click', () => void exclusive(() => save('quick')));
el('quick-load').addEventListener('click', () => void exclusive(() => restore('quick')));
function applyAudio() {
  const silent = preferences.muted || preferences.volume === 0;
  if (runtime.ready) runtime.volume(silent ? 0 : preferences.volume / 100);
  el('mute').textContent = silent ? '♪ 声音关' : '♪ 声音开';
  el('mute').setAttribute('aria-pressed', String(silent));
  el<HTMLInputElement>('volume').value = String(preferences.volume);
  el('volume-value').textContent = `${preferences.volume}%`;
}
el('mute').addEventListener('click', () => {
  preferences.muted = !(preferences.muted || preferences.volume === 0);
  if (!preferences.muted && preferences.volume === 0) preferences.volume = 65;
  applyAudio(); writePreferences(preferences);
});
el('volume').addEventListener('input', () => { preferences.volume = Number(el<HTMLInputElement>('volume').value); preferences.muted = false; applyAudio(); writePreferences(preferences); });
el('restart').addEventListener('click', () => void exclusive(async () => { if (confirm('重新开始这一局？已保存的存档会保留。')) { runtime.restart(); toast('游戏已重新开始。'); } }));
el('import-save').addEventListener('click', () => el<HTMLInputElement>('save-file').click());
el('save-file').addEventListener('change', () => {
  const input = el<HTMLInputElement>('save-file'); const file = input.files?.[0]; input.value = '';
  if (!file) return;
  void exclusive(async () => {
    if (file.size > 12 * 1024 * 1024) throw new Error('备份文件过大。');
    const backup = validateSaveFile(JSON.parse(await file.text()), game.sha256, game.runtimeProfileId);
    const state = Uint8Array.from(atob(backup.stateBase64), char => char.charCodeAt(0));
    if (await sha256(state) !== backup.stateSha256) throw new Error('备份校验失败，未导入。');
    if (!confirm('将此备份导入快速存档槽？现有快存将被覆盖。')) return;
    await putSave(game, 'quick', state); await refreshSlots(); toast('备份已导入快速存档，点击“读取快存”继续。');
  });
});
const gamepad = bindGamepad({ send: (button, down) => runtime.input(button, down), enabled: () => started && !busy && !menuOpen && !runtime.paused, menu: () => { if (!busy) { menuOpen ? resumeGame() : openMenu(); } } });
bindPlayerLayout(preferences, releaseInputs);
applyAudio();
el('pause-menu').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [...el('pause-menu').querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not([hidden]),select,summary')].filter(node => node.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
function suspend() { if (started) { interrupted = true; openMenu(false); } }
window.addEventListener('blur', suspend);
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('pagehide', () => { releaseInputs(); runtime.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
el('launch').addEventListener('click', () => {
  if (!runtime.ready) return;
  started = true; interrupted = false; runtime.resume(); el('launch-overlay').hidden = true; update();
  if (requestedSlot) void exclusive(() => restore(requestedSlot));
});
async function init() {
  try {
    if (!window.isSecureContext || !crypto.subtle) throw new Error('请使用本机 localhost / 127.0.0.1 地址，或配置 HTTPS 后访问。');
    const id = params.get('game'); if (!id) throw new Error('缺少游戏信息，请返回游戏库选择卡带。');
    const response = await fetch(`/api/games/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('找不到这张卡带，请返回游戏库重新选择。');
    game = await response.json(); el('game-title').textContent = game.title; el('launch-title').textContent = game.title;
    document.title = `${game.title} · 像素游乐室`;
    el('rom-info').textContent = `${game.system} · ${(game.sizeBytes / 1024).toFixed(0)} KB\nSHA-256: ${game.sha256}\n${game.inspection.warnings.length ? '检测到旧式文件头，使用原始文件运行。' : '标准 NES 文件头。'}`;
    try { await refreshSlots(); } catch { toast('本地存档读取失败，本次仍可尝试游戏。', true); }
    await runtime.prepare(game, message => { el('load-message').textContent = message; });
    applyAudio();
    el('load-message').textContent = '卡带已就绪。点击开始，再按 START 进入游戏。';
    el<HTMLButtonElement>('launch').disabled = false;
    el('launch').textContent = requestedSlot && records.has(requestedSlot) ? '继续上次冒险 ↗' : '开始游戏 ↗';
    update();
  } catch (error) {
    el('launch-title').textContent = '卡带暂时无法启动';
    el('load-message').textContent = error instanceof Error ? error.message : '加载失败，请重试。';
    el('play-status').textContent = '加载失败'; el('retry').hidden = false; el('launch').hidden = true;
  }
}
void init();
