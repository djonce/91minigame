export interface PlayerPreferences { size: 'standard' | 'large'; handed: 'right' | 'left'; direction: 'joystick' | 'dpad'; volume: number; muted: boolean }
const preferenceKey = 'pixel-room-player-preferences-v1';
export function readPreferences(): PlayerPreferences {
  const defaults: PlayerPreferences = { size: 'standard', handed: 'right', direction: 'joystick', volume: 65, muted: false };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferenceKey) || 'null');
    if (!value || typeof value !== 'object') return defaults;
    const saved = value as Partial<PlayerPreferences>;
    return { size: saved.size === 'large' ? 'large' : 'standard', handed: saved.handed === 'left' ? 'left' : 'right', direction: saved.direction === 'dpad' ? 'dpad' : 'joystick', volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? Math.max(0, Math.min(100, saved.volume)) : 65, muted: saved.muted === true };
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
    // Ignore pinch magnification. After rotation, innerWidth can still include
    // the old wide body and trap the page at a zoomed-out scale; use the root
    // viewport as the unscaled bounds instead.
    const normalScale = !viewport || Math.abs(viewport.scale - 1) < 0.01;
    const root = document.documentElement;
    const width = normalScale && viewport ? Math.min(viewport.width, root.clientWidth) : root.clientWidth;
    const height = normalScale && viewport ? viewport.height : root.clientHeight;
    const size = `${Math.round(width)}:${Math.round(height)}:${preferences.size}:${preferences.handed}:${preferences.direction}`;
    if (size !== lastSize) { release(); lastSize = size; }
    body.style.setProperty('--player-height', `${height}px`);
    body.style.setProperty('--player-width', `${width}px`);
    const landscape = width >= 560 && width > height;
    body.dataset.layout = landscape ? 'landscape' : 'portrait';
    body.dataset.handed = preferences.handed;
    body.dataset.direction = preferences.direction;
    document.querySelector('.dpad')?.setAttribute('aria-label', preferences.direction === 'joystick' ? '固定八方向摇杆' : '八方向十字键');
    const available = area.getBoundingClientRect();
    const targetPad = preferences.size === 'large' ? 156 : 144;
    const side = landscape ? Math.min(targetPad + 4, (available.width - 240 - 24) / 2) : (available.width - 12) / 2;
    const pad = Math.min(targetPad, side, landscape ? available.height - 104 : targetPad);
    body.style.setProperty('--pad-size', `${Math.max(96, pad)}px`);
    body.style.setProperty('--side-size', `${Math.max(112, side)}px`);
    const key = Math.min(preferences.size === 'large' ? 72 : 64, (side - 12) / 2);
    body.style.setProperty('--key-size', `${key}px`);
    // Use vertical room to keep a 28px gap between the circular buttons,
    // without taking width away from the game screen.
    const actionX = Math.min(key + 8, Math.max(112, side) - key);
    const actionY = Math.sqrt((key + 28) ** 2 - actionX ** 2);
    body.style.setProperty('--action-x', `${actionX}px`);
    body.style.setProperty('--action-y', `${actionY}px`);
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
  const controls = [
    { id: 'control-size', value: preferences.size, set: (value: string) => { preferences.size = value === 'large' ? 'large' : 'standard'; } },
    { id: 'control-hand', value: preferences.handed, set: (value: string) => { preferences.handed = value === 'left' ? 'left' : 'right'; } },
    { id: 'control-direction', value: preferences.direction, set: (value: string) => { preferences.direction = value === 'dpad' ? 'dpad' : 'joystick'; } },
  ];
  for (const control of controls) {
    const select = document.querySelector<HTMLSelectElement>(`#${control.id}`);
    if (!select) continue;
    select.value = control.value;
    select.addEventListener('change', () => { control.set(select.value); layout(); writePreferences(preferences); });
  }
  layout();
  return { update: layout };
}
