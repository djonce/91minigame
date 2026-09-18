import type { Game, RuntimeManifest } from '../shared/types';
import { loadRom } from './storage';

// Version-bound internals are intentionally confined here. See docs/local-development.md.
export interface Ejs423 {
  started: boolean; paused: boolean; canvas: HTMLCanvasElement;
  pause(): void; play(): void; setVolume(value: number): void;
  initGameCore(js: Uint8Array, wasm: Uint8Array, thread?: Uint8Array): void;
  startButtonClicked(button: Element): void;
  startGame(): void;
  elements: { parent: HTMLElement };
  checkStarted(): void;
  retroarchOpts?: { name: string; default: string | number | boolean; isString?: boolean }[];
  Module: {
    AL?: { currentCtx?: { audioCtx?: AudioContext } };
    pauseMainLoop(): void;
    _toggleMainLoop(running: number): void;
    callMain(args: string[]): unknown;
    HEAPU8: Uint8Array;
    _free(pointer: number): void;
    netplayIterate?(): Promise<void>;
  };
  gameManager: {
    getState(): Uint8Array; loadState(state: Uint8Array): void; restart(): void;
    simulateInput(player: number, index: number, value: number): void;
    FS: { unlink(path: string): void; readFile(path: string): Uint8Array };
    functions: { getFrameNum(): number; screenshot(): void; saveStateInfo(): string };
  };
}
type EjsWindow = Window & typeof globalThis & { EJS_emulator?: Ejs423; [key: `EJS_${string}`]: unknown };
const host = window as EjsWindow;
export const buttons = { b: 0, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8 } as const;
export type Input = keyof typeof buttons;
export class RuntimeAdapter {
  private emulator?: Ejs423;
  private active = new Set<Input>();
  private controller = new AbortController();
  private attempted = false;
  private originalFetch = window.fetch;
  private localFetch?: typeof fetch;
  private screenshotPending?: Promise<Blob | undefined>;
  private cachedScreenshot?: { frame: number; blob: Blob };
  async prepare(game: Game, progress: (message: string) => void, hooks?: { ready(ejs: Ejs423, fail: (error: Error) => void): void }): Promise<void> {
    if (this.attempted) throw new Error('请重新加载页面后重试。');
    this.attempted = true;
    const signal = this.controller.signal;
    const timeout = setTimeout(() => this.controller.abort(new Error('初始化超时，请检查网络后重试。')), 60000);
    try {
      const response = await fetch('/api/runtime', { signal });
      if (!response.ok) throw new Error('无法获取模拟器配置。');
      const { ready, runtime }: { ready: boolean; runtime: RuntimeManifest } = await response.json();
      if (!ready || runtime.version !== '4.2.3' || runtime.profileId !== game.runtimeProfileId) throw new Error('运行环境未就绪，请执行 pnpm runtime:setup 后刷新。');
      progress('正在检查模拟器核心…');
      const base = '/runtime/emulatorjs/4.2.3/';
      const files = ['data/loader.js', 'data/emulator.min.js', 'data/emulator.min.css', 'data/cores/fceumm-legacy-wasm.data', 'data/cores/reports/fceumm.json'];
      await Promise.all(files.map(async file => {
        const result = await fetch(base + file, { method: 'HEAD', signal });
        if (!result.ok) throw new Error('模拟器资源缺失或校验失败，请执行 pnpm runtime:verify。');
      }));
      const bytes = await loadRom(game, signal, progress);
      signal.throwIfAborted();
      progress('卡带校验通过，正在启动模拟器…');
      // Upstream automatically checks its public CDN on localhost. Redirect only
      // that version probe to our pinned file; core and ROM requests stay intact.
      this.localFetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        return this.originalFetch.call(window, url === 'https://cdn.emulatorjs.org/stable/data/version.json' ? base + 'data/version.json' : input, init);
      };
      window.fetch = this.localFetch;
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason || new Error('已取消加载。'));
        signal.addEventListener('abort', abort, { once: true });
        Object.assign(host, {
          EJS_player: '#emulator', EJS_core: 'fceumm', EJS_pathtodata: base + 'data/',
          EJS_gameUrl: new File([new Uint8Array(bytes).buffer], `${game.id}.nes`),
          EJS_gameName: `${game.id}-${game.sha256.slice(0, 12)}`, EJS_gameID: game.id,
          EJS_startOnLoaded: !hooks, EJS_forceLegacyCores: true, EJS_threads: false,
          EJS_ready: hooks ? () => {
            try { hooks.ready(host.EJS_emulator!, reject); } catch (error) { reject(error); }
          } : undefined,
          EJS_language: 'en-US', EJS_disableAutoLang: false, EJS_noAutoFocus: true,
          EJS_volume: 0.65, EJS_color: '#b9dc85', EJS_backgroundColor: '#141b15',
          EJS_disableDatabases: true, EJS_disableLocalStorage: true,
          EJS_defaultControls: { 0: {}, 1: {}, 2: {}, 3: {} }, EJS_VirtualGamepadSettings: [],
          EJS_defaultOptions: { 'vsync': 'enabled', 'save-state-slot': '0' },
          EJS_onGameStart: () => {
            if (signal.aborted) { host.EJS_emulator?.pause(); return; }
            const emulator = host.EJS_emulator;
            if (!emulator?.gameManager?.getState || !emulator?.gameManager?.simulateInput) { reject(new Error('模拟器接口不兼容。')); return; }
            this.emulator = emulator;
            emulator.pause();
            signal.removeEventListener('abort', abort);
            resolve();
          },
        });
        const script = document.createElement('script');
        script.src = base + 'data/loader.js';
        script.onerror = () => reject(new Error('播放器脚本加载失败，请重新加载。'));
        document.head.appendChild(script);
      });
    } finally { clearTimeout(timeout); }
  }
  get ready() { return Boolean(this.emulator); }
  /** Version-bound access for the isolated deterministic player. */
  get netplayEngine() { return this.require(); }
  get paused() { return this.emulator?.paused ?? true; }
  get frame() { return this.require().gameManager.functions.getFrameNum(); }
  private require() { if (!this.emulator) throw new Error('游戏尚未准备好。'); return this.emulator; }
  resume() {
    const ejs = this.require();
    const audio = ejs.Module.AL?.currentCtx?.audioCtx;
    if (audio?.state === 'suspended') void audio.resume().catch(() => { /* Next user action retries. */ });
    ejs.play();
  }
  pause() { this.releaseAll(); this.emulator?.pause(); }
  volume(value: number) { this.require().setVolume(Math.max(0, Math.min(1, value))); }
  input(button: Input, down: boolean) {
    if (!this.emulator || (down && this.paused) || this.active.has(button) === down) return;
    this.emulator.gameManager.simulateInput(0, buttons[button], down ? 1 : 0);
    if (down) this.active.add(button); else this.active.delete(button);
  }
  releaseAll() { for (const button of this.active) this.emulator?.gameManager.simulateInput(0, buttons[button], 0); this.active.clear(); }
  capture(): Uint8Array { return this.require().gameManager.getState(); }
  screenshot(): Promise<Blob | undefined> {
    const frame = this.frame;
    if (this.cachedScreenshot?.frame === frame) return Promise.resolve(this.cachedScreenshot.blob);
    if (this.screenshotPending) return this.screenshotPending;
    this.screenshotPending = this.capturePng().then(blob => { if (blob) this.cachedScreenshot = { frame, blob }; return blob; }).finally(() => { this.screenshotPending = undefined; });
    return this.screenshotPending;
  }
  private async capturePng(): Promise<Blob | undefined> {
    // Read the core's cached video frame: WebGL canvas pixels are cleared after
    // compositing, and 4.2.3's high-level retroarch screenshot hangs at upscale=1.
    const manager = this.require().gameManager;
    try { manager.FS.unlink('/screenshot.png'); } catch { /* No previous capture. */ }
    manager.functions.screenshot();
    for (let attempt = 0; attempt < 24; attempt++) {
      try {
        const bytes = new Uint8Array(manager.FS.readFile('/screenshot.png'));
        if (bytes.length > 8 && bytes[0] === 137 && bytes[1] === 80) return new Blob([bytes.buffer], { type: 'image/png' });
      } catch { /* Core may need a short time to finish writing. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return undefined;
  }
  async restore(state: Uint8Array): Promise<void> {
    this.cachedScreenshot = undefined;
    const emulator = this.require();
    this.pause();
    emulator.gameManager.loadState(state);
    // load_state queues a RetroArch task. It only completes on a running frame.
    // Pump the queue and compare the serialized result before reporting success.
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let attempts = 0;
        const check = () => {
          try {
            const actual = emulator.gameManager.getState();
            if (actual.length === state.length && actual.every((value, index) => value === state[index])) { resolve(); return; }
            if (++attempts >= 8) { reject(new Error('核心未能确认存档恢复，请重新进入游戏后重试。原存档已保留。')); return; }
            raf = requestAnimationFrame(check);
          } catch (error) { reject(error); }
        };
        timeout = setTimeout(() => reject(new Error('恢复存档超时，请保持页面在前台后重试。')), 2500);
        emulator.play(); raf = requestAnimationFrame(check);
      });
    } finally { clearTimeout(timeout); cancelAnimationFrame(raf); emulator.pause(); }
  }
  restart() { this.releaseAll(); this.cachedScreenshot = undefined; this.require().gameManager.restart(); }
  dispose() { this.controller.abort(); this.pause(); if (window.fetch === this.localFetch) window.fetch = this.originalFetch; }
}
