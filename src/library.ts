import './style.css';
import type { Game, SaveRecord } from '../shared/types';
import { clearRomCache, listSaves } from './storage';
import { dateLabel, el, escapeHtml, toast } from './ui';
let games: Game[] = [];
let saves: SaveRecord[] = [];
const urls: string[] = [];
const route = () => {
  const id = ['library', 'saves', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'library';
  document.querySelectorAll<HTMLElement>('.view').forEach(node => { node.hidden = node.id !== id; });
  document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('active', node.getAttribute('href') === `#${id}`));
};
addEventListener('hashchange', route); route();
function render() {
  el('game-count').textContent = `${games.length.toString().padStart(2, '0')}`;
  el('save-count').textContent = String(saves.length);
  el('games').innerHTML = games.length ? games.map((game, index) => {
    const recent = saves.find(save => save.romSha256 === game.sha256 && save.runtimeProfileId === game.runtimeProfileId);
    const title = escapeHtml(game.title);
    return `<article class="game-card"><div class="cartridge-art"><span class="art-tag">THE NES COLLECTION</span><div class="cartridge"><div class="cartridge-label"><small>FAMILY COMPUTER</small><strong>${title}</strong><svg viewBox="0 0 48 32" aria-hidden="true"><path fill="#526537" d="M10 2h28v4h4v20H6V6h4z"/><path fill="#cce492" d="M14 6h20v10H14z"/><path fill="#243820" d="M4 16h8v16H4zm32 0h8v16h-8zM18 20h12v8H18z"/><path fill="#dcecb7" d="M12 20h4v4h-4zm20 0h4v4h-4z"/></svg><small>8-BIT ADVENTURE</small></div></div><span class="art-index">NO. ${String(index + 1).padStart(3, '0')}</span></div><div class="game-card-content"><h3>${title}</h3><p class="card-meta">NES / FC &nbsp;·&nbsp; ${(game.sizeBytes / 1024).toFixed(0)} KB &nbsp;·&nbsp; ${game.netplay ? `${Math.min(game.netplay.players, 3)} 人联机测试` : '单人'}</p><a class="button primary" href="/player.html?game=${encodeURIComponent(game.id)}${recent ? `&slot=${recent.slot}` : ''}">${recent ? '继续游戏' : '开始游戏'} <span>↗</span></a>${game.netplay ? `<a class="button secondary netplay-link" href="/netplay.html?game=${encodeURIComponent(game.id)}">好友联机 <span>↗</span></a>` : ''}<p class="card-recent">${recent ? `最近存档 ${dateLabel(recent.updatedAt)}` : '一张卡带，一段新的冒险。'}</p></div></article>`;
  }).join('') : '<p class="empty">还没有可用的卡带，请稍后再来看看。</p>';
  urls.splice(0).forEach(url => URL.revokeObjectURL(url));
  el('save-list').innerHTML = saves.length ? saves.map(save => {
    const game = games.find(game => game.sha256 === save.romSha256 && game.runtimeProfileId === save.runtimeProfileId);
    let thumbnail = '';
    if (save.screenshot) { const url = URL.createObjectURL(save.screenshot); urls.push(url); thumbnail = `<img src="${url}" alt="存档画面">`; }
    return `<article class="save-row">${thumbnail}<div><h3>${escapeHtml(save.title)} · ${save.slot === 'quick' ? '快速存档' : `存档 ${save.slot.slice(-1)}`}</h3><p>${dateLabel(save.updatedAt)} · ${(save.state.length / 1024).toFixed(0)} KB${game ? '' : ' · 对应卡带或核心暂不可用'}</p></div>${game ? `<a class="button secondary" href="/player.html?game=${encodeURIComponent(game.id)}&slot=${save.slot}">继续 ↗</a>` : ''}</article>`;
  }).join('') : '<p class="empty">还没有存档。<br>开始一局游戏，保存你的第一个瞬间。</p>';
}
el('clear-cache').addEventListener('click', async () => {
  try { await clearRomCache(); toast('游戏缓存已清理，存档已保留。'); } catch { toast('缓存清理失败，请检查浏览器存储设置。', true); }
});
async function init() {
  const results = await Promise.allSettled([
    fetch('/api/games').then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ games: Game[]; notices: string[] }>; }),
    listSaves(),
    fetch('/api/runtime').then(response => response.json()),
  ]);
  const [catalog, saved, runtime] = results;
  if (catalog.status === 'fulfilled') {
    games = catalog.value.games;
    if (catalog.value.notices.length) { el('library-notice').className = 'notice'; el('library-notice').textContent = catalog.value.notices.join(' '); }
  } else { el('library-notice').className = 'notice'; el('library-notice').textContent = '无法连接游戏服务，请稍后刷新重试。'; }
  if (saved.status === 'fulfilled') saves = saved.value;
  else toast('本地存档不可用，请检查浏览器存储设置。', true);
  el('runtime-info').textContent = runtime.status === 'fulfilled' && runtime.value.ready ? `EmulatorJS ${runtime.value.runtime.version} · FCEUmm · 单线程` : '运行环境暂不可用，请稍后重试。';
  render();
}
void init();
