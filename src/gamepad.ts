import type { Input } from './runtime-adapter';
import { bindPlayerGestures } from './player-gestures';

const sectors: Input[][] = [['right'], ['right', 'down'], ['down'], ['down', 'left'], ['left'], ['left', 'up'], ['up'], ['up', 'right']];
export function directionAt(x: number, y: number, width: number, height: number, previous: readonly Input[] = []): Input[] {
  const dx = (x / width - 0.5) * 2;
  const dy = (y / height - 0.5) * 2;
  if (Math.hypot(dx, dy) < 0.2) return [];
  const angle = Math.atan2(dy, dx);
  const last = sectors.findIndex(inputs => inputs.length === previous.length && inputs.every(input => previous.includes(input)));
  if (last !== -1) {
    const difference = angle - last * Math.PI / 4;
    // Five degrees of hysteresis prevent thumb jitter at sector boundaries.
    if (Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))) <= Math.PI / 8 + Math.PI / 36) return sectors[last];
  }
  return sectors[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}

// Aggregate sources before sending edges: releasing one finger must not cancel
// the same button held by a keyboard, or another finger.
export class InputSources {
  private sources = new Map<string, readonly Input[]>();
  private active = new Set<Input>();
  constructor(private send: (button: Input, down: boolean) => void) {}
  set(source: string, buttons: readonly Input[]) {
    if (buttons.length) this.sources.set(source, buttons); else this.sources.delete(source);
    const next = new Set([...this.sources.values()].flat());
    for (const button of this.active) if (!next.has(button)) this.send(button, false);
    for (const button of next) if (!this.active.has(button)) this.send(button, true);
    this.active = next;
  }
  release() {
    this.sources.clear();
    for (const button of this.active) this.send(button, false);
    this.active.clear();
  }
}

export function bindGamepad(options: { send(button: Input, down: boolean): void; enabled(): boolean; menu(): void }) {
  bindPlayerGestures();
  const states = new InputSources((name, down) => {
    options.send(name, down);
    const button = document.querySelector<HTMLButtonElement>(`[data-input="${name}"]`);
    button?.classList.toggle('pressed', down);
    button?.setAttribute('aria-pressed', String(down));
  });
  const pointers = new Map<number, HTMLElement>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const set = (source: string, buttons: Input[]) => states.set(source, options.enabled() ? buttons : []);
  const dpad = document.querySelector<HTMLElement>('.dpad')!;
  let directionInputs: Input[] = [];
  function centerStick() {
    directionInputs = [];
    dpad.style.setProperty('--stick-x', '0px');
    dpad.style.setProperty('--stick-y', '0px');
    dpad.classList.remove('dragging');
  }
  function direction(event: PointerEvent) {
    if (pointers.get(event.pointerId) !== dpad) return;
    const box = dpad.getBoundingClientRect();
    const joystick = document.body.dataset.direction === 'joystick';
    directionInputs = directionAt(event.clientX - box.left, event.clientY - box.top, box.width, box.height, joystick ? directionInputs : []);
    set(`pointer-${event.pointerId}`, directionInputs);
    if (joystick) {
      const dx = event.clientX - box.left - box.width / 2;
      const dy = event.clientY - box.top - box.height / 2;
      const travel = Math.min(box.width, box.height) * 0.27;
      const scale = Math.min(1, travel / (Math.hypot(dx, dy) || 1));
      dpad.style.setProperty('--stick-x', `${dx * scale}px`);
      dpad.style.setProperty('--stick-y', `${dy * scale}px`);
    }
  }
  dpad.addEventListener('pointerdown', event => {
    if (!options.enabled() || [...pointers.values()].includes(dpad)) return;
    event.preventDefault();
    pointers.set(event.pointerId, dpad); dpad.setPointerCapture(event.pointerId); dpad.classList.add('dragging'); direction(event);
  });
  dpad.addEventListener('pointermove', direction);
  const releasePointer = (event: PointerEvent) => {
    if (pointers.get(event.pointerId) === dpad) centerStick();
    pointers.delete(event.pointerId); states.set(`pointer-${event.pointerId}`, []);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) dpad.addEventListener(type, releasePointer);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-input]')) {
    const name = button.dataset.input as Input;
    if (!dpad.contains(button)) {
      button.addEventListener('pointerdown', event => {
        if (!options.enabled()) return;
        event.preventDefault(); pointers.set(event.pointerId, button); button.setPointerCapture(event.pointerId);
        set(`pointer-${event.pointerId}`, [name]);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, releasePointer);
    }
    button.addEventListener('click', event => {
      if (event.detail !== 0 || !options.enabled()) return;
      set(`accessible-${name}`, [name]);
      const timer = setTimeout(() => { states.set(`accessible-${name}`, []); timers.delete(timer); }, 120);
      timers.add(timer);
    });
  }
  const keys: Record<string, Input> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyZ: 'b', KeyX: 'a', Enter: 'start', ShiftLeft: 'select', ShiftRight: 'select' };
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape') { if (!event.repeat) options.menu(); event.preventDefault(); return; }
    if (!options.enabled() || (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable=true]'))) return;
    const button = keys[event.code]; if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) set(`key-${event.code}`, [button]);
  }, { capture: true });
  window.addEventListener('keyup', event => {
    if (!keys[event.code]) return;
    states.set(`key-${event.code}`, []);
    if (options.enabled()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true });
  return {
    release() {
      states.release();
      centerStick();
      for (const [id, element] of pointers) if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      pointers.clear();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
