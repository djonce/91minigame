import '../style.css';
import '../player.css';
import './style.css';
import type { Game } from '../../shared/types';
import { INPUT_KEYS, type RoomView } from '../../shared/netplay';
import { NetplayRuntime } from './runtime';
import { NetplayClient } from './client';
import { bindGamepad } from '../gamepad';
import { bindPlayerLayout, readPreferences, writePreferences } from '../player-layout';
import { el, toast } from '../ui';

const params = new URLSearchParams(location.search);
const preferences = readPreferences();
const runtime = new NetplayRuntime();
let game: Game | undefined;
let prepared = false;
let manualMenu = false;
let lastPhase: RoomView['phase'] | undefined;
const client = new NetplayClient({ runtime, prepare, update, error });
document.body.dataset.embedded = String(params.get('source') === 'wechat');
el<HTMLInputElement>('room-code').value = params.get('room') || '';
function error(message: string) { el('room-error').textContent = message; el('room-error').hidden = false; manualMenu = true; update(); }
function clearError() { el('room-error').hidden = true; }
async function prepare(room: RoomView) {
  if (prepared) return;
  const response = await fetch(`/api/games/${encodeURIComponent(room.game.gameId)}`);
  if (!response.ok) throw new Error('无法加载房间中的卡带。');
  game = await response.json();
  if (!game || game.sha256 !== room.game.sha256 || game.runtimeProfileId !== room.game.runtimeProfileId) throw new Error('卡带或核心版本已变化，请重新创建房间。');
  el('game-title').textContent = game.title;
  await runtime.prepare(game, message => { el('room-notice').textContent = message; });
  if (runtime.profile !== room.game.profile) throw new Error('房间的手柄配置不兼容。');
  runtime.volume(preferences.muted ? 0 : preferences.volume / 100);
  prepared = true;
}
function update() {
  const room = client.room;
  el('entry-form').hidden = Boolean(room); el('joined-room').hidden = !room;
  if (!room) return;
  const playing = room.phase === 'playing';
  if (playing && lastPhase !== 'playing') manualMenu = false;
  lastPhase = room.phase;
  if (!playing) gamepad.release();
  const me = room.members.find(m => m.id === client.memberId);
  el('seat-label').textContent = me?.seat == null ? '观战' : `${me.seat + 1}P`;
  el('invite-code').textContent = room.code;
  el('room-title').textContent = playing ? '这一局，一起玩' : room.phase === 'ended' ? '本局已结束' : '朋友们的游戏房间';
  const labels = { lobby: '等待朋友准备', loading: '正在同步这一局…', playing: '正在联机', paused: '已暂停', ended: '已结束' };
  el('play-status').textContent = labels[room.phase];
  if (prepared) el('room-notice').textContent = room.reason || labels[room.phase];
  el('members').replaceChildren(...room.members.map(member => {
    const li = document.createElement('li');
    li.textContent = `${member.seat == null ? '观战' : `玩家 ${member.seat + 1}`} ${member.id === client.memberId ? '· 你' : ''} ${member.id === room.owner ? '· 房主' : ''}　${!member.connected ? '连接中断' : member.ready ? '已准备' : '准备中'}`;
    return li;
  }));
  el('room-help').textContent = room.game.players > 2 ? `本模式支持 ${room.game.players} 人操作；当前测试房间最多三人。` : '两位玩家操作，一位朋友观战。房主退出会结束这一局。';
  document.querySelector('.room-note')!.textContent = `测试版 · 本卡带配置为 ${room.game.players} 位玩家，房间最多三位参与者。进入游戏后请选择相应人数的游戏模式。玩家切到后台会暂停这一局。`;
  const ready = el<HTMLButtonElement>('ready');
  el<HTMLButtonElement>('sound').disabled = !prepared;
  el('sound').textContent = preferences.muted ? '♪ 声音关' : '♪ 声音开';
  ready.disabled = !prepared || Boolean(me?.ready) || room.phase === 'ended';
  ready.textContent = !prepared ? '正在加载卡带…' : me?.ready ? '已准备' : '我准备好了';
  const start = el<HTMLButtonElement>('start-room'); start.hidden = !client.owner || room.phase !== 'lobby';
  start.disabled = room.members.filter(m => m.seat !== null).length < 2 || room.members.some(m => !m.ready || !m.connected);
  el('resume-room').hidden = !client.owner || room.phase !== 'paused';
  el<HTMLButtonElement>('resume-room').disabled = room.members.some(m => !m.ready || !m.connected);
  el('return-game').hidden = !playing;
  el('waiting-overlay').hidden = playing;
  el('waiting-overlay').textContent = labels[room.phase];
  const menu = !playing || manualMenu;
  el('room-panel').hidden = !menu;
  el('player-workspace').inert = menu;
  document.querySelector<HTMLElement>('.controller')!.inert = me?.seat == null;
  document.body.dataset.spectator = String(me?.seat == null);
  el('connection-stats').textContent = `已执行 ${runtime.frame} 帧 · 发送 ${(client.sentBytes / 1024).toFixed(1)} KB · 接收 ${(client.receivedBytes / 1024).toFixed(1)} KB（应用数据，不含网络协议开销）`;
  document.body.dataset.frame = String(runtime.frame);
}
function menu() { manualMenu = true; gamepad.release(); if (client.seat != null) client.pause('menu'); update(); }
const gamepad = bindGamepad({
  send(button, down) { const bit = 1 << INPUT_KEYS.indexOf(button); client.buttons = down ? client.buttons | bit : client.buttons & ~bit; },
  enabled: () => prepared && client.room?.phase === 'playing' && client.seat != null && !manualMenu,
  menu,
});
bindPlayerLayout(preferences, () => gamepad.release());
el('pause').addEventListener('click', menu);
el('return-game').addEventListener('click', () => { manualMenu = false; update(); });
el('create-room').addEventListener('click', () => { clearError(); if (game) client.create(game.id); });
el('entry-form').addEventListener('submit', event => { event.preventDefault(); clearError(); client.join(el<HTMLInputElement>('room-code').value, el<HTMLInputElement>('spectator').checked); });
el('ready').addEventListener('click', () => { clearError(); void runtime.unlockAudio().then(() => client.ready()).catch(() => error('请再次点击准备，允许播放声音。')); });
el('start-room').addEventListener('click', () => { clearError(); manualMenu = false; client.start(); });
el('resume-room').addEventListener('click', () => { clearError(); manualMenu = false; void runtime.unlockAudio(); client.resume(); });
el('leave-room').addEventListener('click', () => { client.leave(); location.href = '/'; });
el('copy-invite').addEventListener('click', () => {
  if (!client.room) return;
  const url = new URL('/netplay.html', location.origin); url.searchParams.set('room', client.room.code); url.searchParams.set('game', client.room.game.gameId);
  if (!navigator.clipboard) { error(`请复制房间号：${client.room.code}`); return; }
  void navigator.clipboard.writeText(url.href).then(() => toast('邀请链接已复制，发给朋友即可。')).catch(() => { error(`请复制房间号：${client.room!.code}`); });
});
el('sound').addEventListener('click', () => {
  preferences.muted = !preferences.muted; runtime.volume(preferences.muted ? 0 : preferences.volume / 100);
  el('sound').textContent = preferences.muted ? '♪ 声音关' : '♪ 声音开'; writePreferences(preferences);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { gamepad.release(); if (client.seat != null) client.pause('background'); }
});
window.addEventListener('blur', () => gamepad.release());
window.addEventListener('pagehide', () => { gamepad.release(); if (client.seat != null) client.pause('background'); });
void (async () => {
  const response = await fetch('/api/games');
  if (!response.ok) throw new Error('游戏目录暂不可用。');
  const { games }: { games: Game[] } = await response.json();
  game = games.find(item => item.id === params.get('game')) || games.find(item => item.netplay);
  if (game) { el('game-title').textContent = game.title; el<HTMLButtonElement>('create-room').disabled = !game.netplay; }
  else error('暂时没有可用于联机的卡带。');
})().catch(cause => error(cause instanceof Error ? cause.message : '无法加载游戏。'));
