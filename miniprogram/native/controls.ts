import { directionAt, InputSources, type Input } from './vendor/core';
export interface Contact { identifier: number; clientX: number; clientY: number }
export interface Box { left: number; top: number; width: number; height: number }
export class NativeControls {
  private stick: number | null = null;
  private previous: Input[] = [];
  private sources: InputSources;
  constructor(send: (button: Input, down: boolean) => void,
    private draw: (x: number, y: number) => void) { this.sources = new InputSources(send); }
  startStick(touches: Contact[], box: Box) {
    if (this.stick !== null || !touches.length) return;
    this.stick = touches[0].identifier;
    this.moveStick(touches, box);
  }
  moveStick(touches: Contact[], box: Box) {
    const touch = touches.find(item => item.identifier === this.stick);
    if (!touch || !box.width || !box.height) return;
    const x = touch.clientX - box.left, y = touch.clientY - box.top;
    this.previous = directionAt(x, y, box.width, box.height, this.previous);
    this.sources.set(`finger-${this.stick}`, this.previous);
    const dx = x - box.width / 2, dy = y - box.height / 2;
    const scale = Math.min(1, box.width * 0.27 / (Math.hypot(dx, dy) || 1));
    this.draw(Math.round(dx * scale), Math.round(dy * scale));
  }
  press(touches: Contact[], button: Input) {
    for (const touch of touches) if (touch.identifier !== this.stick) this.sources.set(`finger-${touch.identifier}`, [button]);
  }
  end(touches: Contact[]) {
    for (const touch of touches) {
      this.sources.set(`finger-${touch.identifier}`, []);
      if (touch.identifier === this.stick) { this.stick = null; this.previous = []; this.draw(0, 0); }
    }
  }
  release() { this.sources.release(); this.stick = null; this.previous = []; this.draw(0, 0); }
}
