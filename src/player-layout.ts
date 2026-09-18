export interface PlayerPreferences { size: 'standard' | 'large'; handed: 'right' | 'left'; volume: number; muted: boolean }
const preferenceKey = 'pixel-room-player-preferences-v1';
export function readPreferences(): PlayerPreferences {
  const defaults: PlayerPreferences = { size: 'standard', handed: 'right', volume: 65, muted: false };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
    if (!value || typeof value !== 'object') return defaults;
    const saved = value as Partial<PlayerPreferences>;
    return { size: saved.size === 'large' ? 'large' : 'standard', handed: saved.handed === 'left' ? 'left' : 'right', volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.max(0, Math.min(100, saved.volume)) : 65, muted: saved.muted === true };
  } catch { return defaults; }
}
export function writePreferences(preferences: PlayerPreferences) {
  try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Private storage can be unavailable; this session still works. */ }
}

export function bindPlayerLayout(preferences: PlayerPreferences, release: () => void) {
  const body = document.body;
  const area = document.querySelector<HTMLElement>('.play-area')!;
  const slot = document.querySelector<HTMLElement>('.screen-slot')!;
  const stage = document.querySelector<HTMLElement>('.screen-stage')!;
  let lastSize = '';
  function fitScreen() {
    const { width, height } = slot.getBoundingClientRect();
    const screenWidth = Math.max(1, Math.min(width, height * 4 / 3));
    stage.style.width = `${screenWidth}px`;
    stage.style.height = `${screenWidth * 3 / 4}px`;
  }
  function layout() {
    const viewport = window.visualViewport;
    // Ignore pinch magnification; it must not rebuild the underlying layout.
    const normalScale = !viewport || Math.abs(viewport.scale - 1) < 0.01;
    const width = normalScale && viewport ? viewport.width : window.innerWidth;
    const height = normalScale && viewport ? viewport.height : window.innerHeight;
    const size = `${Math.round(width)}:${Math.round(height)}:${preferences.size}:${preferences.handed}`;
    if (size !== lastSize) { release(); lastSize = size; }
    body.style.setProperty('--player-height', `${height}px`);
    body.style.setProperty('--player-width', `${width}px`);
    const landscape = width >= 560 && width > height;
    body.dataset.layout = landscape ? 'landscape' : 'portrait';
    body.dataset.handed = preferences.handed;
    const available = area.getBoundingClientRect();
    const targetPad = preferences.size === 'large' ? 156 : 144;
    const side = landscape ? Math.min(targetPad + 4, (available.width - 240 - 24) / 2) : (available.width - 12) / 2;
    const pad = Math.min(targetPad, side, landscape ? available.height - 104 : targetPad);
    body.style.setProperty('--pad-size', `${Math.max(96, pad)}px`);
    body.style.setProperty('--side-size', `${Math.max(112, side)}px`);
    body.style.setProperty('--key-size', `${Math.min(preferences.size === 'large' ? 72 : 64, (side - 12) / 2)}px`);
    body.style.setProperty('--control-height', `${Math.max(132, pad + 8)}px`);
    fitScreen();
  }
  let pending = 0;
  const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(layout); };
  const observer = new ResizeObserver(fitScreen); observer.observe(slot);
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  // Page orientation can change before the final viewport size arrives.
  window.addEventListener('orientationchange', () => { release(); schedule(); });
  layout();
  return { update: layout };
}
