import { SAMPLE_RATE } from './session';

// Short scheduled PCM blocks avoid a DOM AudioContext or ScriptProcessor callback.
export class NativeAudio {
  private context?: WechatMiniprogram.WebAudioContext;
  private left = new Float32Array(2048);
  private right = new Float32Array(2048);
  private cursor = 0;
  private nextTime = 0;
  private sources = new Set<WechatMiniprogram.BufferSourceNode>();
  private active = false;
  private generation = 0;
  underruns = 0;
  constructor(private report: (message: string) => void) {}
  async resume(): Promise<boolean> {
    const generation = ++this.generation;
    try {
      if (!this.context) this.context = wx.createWebAudioContext();
      await this.context.resume();
      if (generation !== this.generation) return false;
      if (this.context.state !== 'running') throw new Error('音频未恢复');
      this.active = true;
      this.cursor = 0; this.nextTime = 0;
      return true;
    } catch {
      if (generation === this.generation) this.report('声音未能启动，可在菜单中重试开启；也可静音继续。');
      return false;
    }
  }
  push(left: number, right: number) {
    if (!this.active || !this.context) return;
    this.left[this.cursor] = left; this.right[this.cursor++] = right;
    if (this.cursor !== this.left.length) return;
    this.cursor = 0;
    try {
      const context = this.context;
      const now = context.currentTime;
      if (this.nextTime && this.nextTime < now) this.underruns++;
      // Drop queued latency after a delayed callback, rather than accumulating it.
      if (this.nextTime > now + 0.22) return;
      const buffer = context.createBuffer(2, this.left.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(this.left); buffer.getChannelData(1).set(this.right);
      const source = context.createBufferSource();
      source.buffer = buffer; source.connect(context.destination);
      source.onended = () => { this.sources.delete(source); source.disconnect(); };
      const when = Math.max(this.nextTime, now + 0.015);
      this.sources.add(source); source.start(when);
      this.nextTime = when + this.left.length / SAMPLE_RATE;
    } catch { this.pause(); this.report('音频输出失败，已静音；可在菜单中重试。'); }
  }
  pause() {
    this.generation++; this.active = false; this.cursor = 0; this.nextTime = 0;
    for (const source of this.sources) {
      source.onended = undefined;
      try { source.stop(); source.disconnect(); } catch { /* already ended */ }
    }
    this.sources.clear();
    if (this.context) void this.context.suspend().catch(() => {});
  }
  close() {
    this.pause();
    const context = this.context; this.context = undefined;
    if (context) void context.close().catch(() => {});
  }
}
