import { config } from '../../config';
import { request, type LocalGame } from '../../services/api';
import { NES, Controller, type Input } from '../../native/vendor/core';
import { PROFILE, CORE_BUILD, FPS, SAMPLE_RATE, FrameClock, verifyRom, parseSave, savePath, type NativeSave } from '../../native/session';
import { NativeControls, type Box } from '../../native/controls';
import { NativeAudio } from '../../native/audio';
import { playerLayout } from '../../native/layout';
import { createRenderer, type Renderer, type RendererKind } from '../../native/renderer';

const buttons = { a: Controller.BUTTON_A, b: Controller.BUTTON_B, select: Controller.BUTTON_SELECT,
  start: Controller.BUTTON_START, up: Controller.BUTTON_UP, down: Controller.BUTTON_DOWN,
  left: Controller.BUTTON_LEFT, right: Controller.BUTTON_RIGHT } as const;
interface Runtime {
  id: string; disposed: boolean; visible: boolean; running: boolean; busy: boolean; token: number;
  game?: LocalGame; rom?: Uint8Array; nes?: NES;
  canvas?: WechatMiniprogram.Canvas; renderer?: Renderer; frame?: Uint32Array;
  dirty: boolean; raf?: number; clock: FrameClock; loop: () => void;
  frames: number; statsFrames: number; statsAt: number;
  statsDrawn: number; statsCoreMs: number; statsDrawMs: number; statsMaxGap: number; lastTickAt: number;
  pendingView: Record<string, unknown>; lastViewAt: number;
  audio: NativeAudio; controls: NativeControls; stick?: Box;
  task?: WechatMiniprogram.RequestTask; resizeTimer?: ReturnType<typeof setTimeout>;
}

Page({
  data: {
    title: '赤色要塞', loading: true, ready: false, running: false, menuOpen: false,
    status: '正在加载卡带', error: '', audioNote: '', sound: true, fps: 0, frames: 0,
    underruns: 0, saveLabel: '', hasSave: false, stickX: 0, stickY: 0,
    pressed: {} as Partial<Record<Input, boolean>>, profile: CORE_BUILD, sha: '',
    rendererKind: 'webgl' as RendererKind, rendererNote: '', drawFps: 0, coreMs: 0, drawMs: 0, maxGapMs: 0,
    fieldStyle: '', layout: playerLayout(351, 550), busy: false,
  },
  runtime: null as Runtime | null,
  onLoad(query: Record<string, string | undefined>) {
    const runtime = {
      id: query.id || 'nes-chise-yaosai', disposed: false, visible: true, running: false, busy: false, token: 0,
      dirty: false, clock: new FrameClock(), frames: 0, statsFrames: 0, statsAt: 0,
      statsDrawn: 0, statsCoreMs: 0, statsDrawMs: 0, statsMaxGap: 0, lastTickAt: 0,
      pendingView: {}, lastViewAt: 0, loop: () => this.tick(),
      audio: new NativeAudio(message => {
        if (!runtime.disposed) this.setData({ audioNote: message, sound: false });
      }),
      controls: new NativeControls((button, down) => {
        if (!runtime.nes) return;
        if (down) runtime.nes.buttonDown(1, buttons[button]); else runtime.nes.buttonUp(1, buttons[button]);
        if (!runtime.disposed) runtime.pendingView[`pressed.${button}`] = down;
      }, (x, y) => { if (!runtime.disposed) { runtime.pendingView.stickX = x; runtime.pendingView.stickY = y; } }),
    } as Runtime;
    this.runtime = runtime;
    this.resize();
  },
  onReady() { this.bindCanvas(() => { void this.loadRom(); }); },
  bindCanvas(done: () => void) {
    const r = this.runtime!;
    const token = r.token;
    wx.createSelectorQuery().select('#nes-screen').fields({ node: true, size: true }).exec(result => {
      if (r.disposed || !r.visible || token !== r.token) return;
      try {
        const canvas = result[0]?.node as WechatMiniprogram.Canvas | undefined;
        if (!canvas) throw new Error('无法创建原生 Canvas，请升级微信后重试。');
        r.renderer?.close(); r.renderer = undefined; r.canvas = canvas;
        r.renderer = createRenderer(canvas, this.data.rendererKind);
        done();
      } catch (error) {
        if (this.data.rendererKind === 'webgl') {
          // The context type cannot be changed on an existing canvas. WXML
          // mounts a separate 2D node before the next selector query.
          this.setData({ rendererKind: '2d', rendererNote: '已使用兼容绘制' }, () => {
            if (!r.disposed && r.visible && token === r.token) this.bindCanvas(done);
          });
        } else this.fail(error);
      }
    });
  },
  canvasError() {
    const r = this.runtime;
    if (!r || r.disposed) return;
    if (this.data.rendererKind === '2d') { this.fail(new Error('画面绘制失败，请退出页面重试。')); return; }
    this.pause('已切换兼容绘制 · 点击继续');
    r.renderer?.close(); r.renderer = undefined;
    this.setData({ rendererKind: '2d', rendererNote: '已使用兼容绘制' }, () => {
      if (!r.nes && !r.busy && !r.disposed) this.bindCanvas(() => { void this.loadRom(); });
    });
  },
  onShow() { if (this.runtime) this.runtime.visible = true; },
  onHide() { if (this.runtime) { this.runtime.visible = false; this.pause('已暂停 · 返回后点击继续'); } },
  onUnload() {
    const r = this.runtime;
    if (!r) return;
    this.pause(); r.disposed = true; r.token++; r.task?.abort();
    if (r.resizeTimer) clearTimeout(r.resizeTimer);
    r.audio.close(); r.nes = undefined; r.rom = undefined;
    r.renderer?.close(); r.renderer = undefined; r.frame = undefined; r.canvas = undefined;
  },
  onResize() {
    this.pause('方向已切换 · 点击继续');
    this.resize();
  },
  resize() {
    const r = this.runtime;
    if (!r) return;
    const window = wx.getWindowInfo();
    const safe = window.safeArea;
    const left = Math.max(12, safe?.left || 0);
    const right = Math.max(12, window.screenWidth - (safe?.right || window.screenWidth));
    const bottom = Math.max(8, Math.min(44, window.screenHeight - (safe?.bottom || window.screenHeight)));
    const width = window.windowWidth - left - right;
    const height = Math.max(160, window.windowHeight - 44 - bottom);
    r.stick = undefined;
    this.setData({ layout: playerLayout(width, height), fieldStyle: `margin-left:${left}px;width:${width}px;height:${height}px;` }, () => this.measureStick());
    if (r.resizeTimer) clearTimeout(r.resizeTimer);
    r.resizeTimer = setTimeout(() => this.measureStick(), 180);
  },
  measureStick() {
    const r = this.runtime;
    if (!r || r.disposed || !r.visible) return;
    wx.createSelectorQuery().select('#native-stick').boundingClientRect(box => {
      if (!r.disposed && box && !Array.isArray(box)) r.stick = box;
    }).exec();
  },
  async loadRom() {
    const r = this.runtime!;
    if (r.busy || r.disposed || !r.canvas) return;
    this.pause(); r.busy = true;
    this.setData({ loading: true, ready: false, error: '', status: '正在加载卡带' });
    try {
      const game = await request<LocalGame>(`/api/games/${encodeURIComponent(r.id)}`);
      if (r.disposed) return;
      if (game.system !== 'NES' || !/^[a-f0-9]{64}$/.test(game.sha256)) throw new Error('游戏信息无效。');
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        r.task = wx.request<ArrayBuffer>({
          url: `${config.apiOrigin}/api/roms/${encodeURIComponent(game.id)}?sha=${game.sha256}`,
          responseType: 'arraybuffer', timeout: 20000,
          success: response => response.statusCode === 200 ? resolve(response.data) : reject(new Error(`ROM 加载失败（${response.statusCode}），请重新加载。`)),
          fail: () => reject(new Error('下载失败，请检查网络及 request 合法域名 minigames.19ba.cn。')),
        });
      });
      if (r.disposed) return;
      const rom = new Uint8Array(bytes);
      verifyRom(rom, game);
      r.game = game; r.rom = rom;
      this.createCore();
      this.setData({ title: game.title, sha: game.sha256, ready: true, status: '准备好了 · 点击开始' });
      this.refreshSave();
      this.measureStick();
    } catch (error) { this.fail(error); }
    finally { r.busy = false; r.task = undefined; if (!r.disposed) this.setData({ loading: false }); }
  },
  createCore() {
    const r = this.runtime!;
    r.controls.release();
    const nes = new NES({ sampleRate: SAMPLE_RATE,
      // Multiple catch-up frames may run in one callback; present only the last.
      onFrame: frame => { r.frame = frame; r.dirty = true; },
      onAudioSample: (left, right) => r.audio.push(left, right),
    });
    nes.loadROM(r.rom!);
    nes.setFramerate(FPS);
    r.nes = nes; r.frames = 0; r.statsFrames = 0; r.frame = undefined; r.dirty = false; r.pendingView = {};
    // Keep the original ROM unchanged, including its legacy DiskDude header.
    this.setData({ frames: 0, fps: 0, pressed: {}, stickX: 0, stickY: 0 });
  },
  async start() {
    const r = this.runtime!;
    if (!r.nes || r.running || r.busy || r.disposed || !r.visible || !this.data.ready) return;
    r.busy = true; this.setData({ busy: true });
    const token = ++r.token;
    if (this.data.sound) {
      const enabled = await r.audio.resume();
      if (!enabled && !r.disposed && token === r.token) this.setData({ sound: false });
    }
    r.busy = false;
    if (!r.disposed) this.setData({ busy: false });
    if (r.disposed || !r.visible || token !== r.token) return;
    r.running = true;
    wx.setKeepScreenOn({ keepScreenOn: true });
    this.setData({ running: true, menuOpen: false, status: '正在游玩', error: '' }, () => {
      // Native Canvas can recreate its drawing surface after hidden / rotation.
      // Wait for the visible view, then bind that surface before starting frames.
      this.bindCanvas(() => {
        if (r.disposed || !r.running || token !== r.token) return;
        const now = Date.now();
        r.clock.reset(now); r.statsAt = now; r.statsFrames = r.frames; r.lastTickAt = now;
        r.statsDrawn = 0; r.statsCoreMs = 0; r.statsDrawMs = 0; r.statsMaxGap = 0;
        r.raf = r.canvas!.requestAnimationFrame(r.loop);
      });
    });
  },
  tick() {
    const r = this.runtime!;
    if (!r.running || r.disposed) return;
    try {
      // Register before emulation so the native animation request can travel
      // to the render thread while JS is computing. pause() cancels it.
      r.raf = r.canvas!.requestAnimationFrame(r.loop);
      const now = Date.now();
      r.statsMaxGap = Math.max(r.statsMaxGap, now - r.lastTickAt); r.lastTickAt = now;
      const count = r.clock.advance(now);
      for (let i = 0; i < count; i++) { r.nes!.frame(); r.frames++; }
      const emulatedAt = Date.now(); r.statsCoreMs += emulatedAt - now;
      if (r.dirty && r.frame) {
        try { r.renderer!.draw(r.frame); }
        catch { this.canvasError(); return; }
        r.dirty = false; r.statsDrawn++;
      }
      r.statsDrawMs += Date.now() - emulatedAt;
      let update: Record<string, unknown> = {};
      if (now - r.lastViewAt >= 33) {
        update = r.pendingView; r.pendingView = {}; r.lastViewAt = now;
      }
      if (now - r.statsAt >= 1000) {
        const elapsed = now - r.statsAt, frames = r.frames - r.statsFrames;
        Object.assign(update, { fps: Math.round(frames * 1000 / elapsed), frames: r.frames, underruns: r.audio.underruns,
          drawFps: Math.round(r.statsDrawn * 1000 / elapsed),
          coreMs: Math.round(r.statsCoreMs * 10 / Math.max(1, frames)) / 10,
          drawMs: Math.round(r.statsDrawMs * 10 / Math.max(1, r.statsDrawn)) / 10, maxGapMs: r.statsMaxGap });
        r.statsFrames = r.frames; r.statsAt = now;
        r.statsDrawn = 0; r.statsCoreMs = 0; r.statsDrawMs = 0; r.statsMaxGap = 0;
      }
      // Only visual feedback is batched. Emulator inputs above remain immediate.
      if (Object.keys(update).length) this.setData(update);
    } catch (error) { this.fail(error); }
  },
  pause(message = '已暂停') {
    const r = this.runtime;
    if (!r) return;
    r.running = false; r.token++;
    if (r.raf !== undefined) r.canvas?.cancelAnimationFrame(r.raf);
    r.raf = undefined; r.controls.release(); r.audio.pause();
    wx.setKeepScreenOn({ keepScreenOn: false });
    if (!r.disposed) this.setData({ ...r.pendingView, running: false, status: message, frames: r.frames, underruns: r.audio.underruns });
    r.pendingView = {};
  },
  openMenu() { this.pause(); this.setData({ menuOpen: true }); },
  closeMenu() { this.setData({ menuOpen: false }); },
  toggleSound() { this.runtime!.audio.pause(); this.setData({ sound: !this.data.sound, audioNote: '' }); },
  restart() {
    wx.showModal({ title: '重新开局', content: '当前未保存的进度会丢失，本地快存会保留。', success: result => {
      if (!result.confirm || this.runtime?.disposed) return;
      try { this.createCore(); this.setData({ menuOpen: false, ready: true, error: '', status: '已重置 · 点击开始' }); }
      catch (error) { this.fail(error); }
    } });
  },
  nativeSavePath() { return `${wx.env.USER_DATA_PATH}/${savePath(this.runtime!.game!.sha256)}`; },
  refreshSave() {
    try {
      const saved = parseSave(wx.getFileSystemManager().readFileSync(this.nativeSavePath(), 'utf8') as string, this.runtime!.game!.sha256);
      this.setData({ hasSave: true, saveLabel: new Date(saved.savedAt).toLocaleString() });
    } catch { this.setData({ hasSave: false, saveLabel: '' }); }
  },
  save() {
    const r = this.runtime!;
    if (!r.nes || !r.game || !this.data.ready || r.busy) return;
    this.pause();
    try {
      const saved: NativeSave = { version: 1, profile: PROFILE, romSha256: r.game.sha256,
        savedAt: Date.now(), frame: r.frames, state: r.nes.toJSON() };
      const text = JSON.stringify(saved);
      parseSave(text, r.game.sha256);
      const fs = wx.getFileSystemManager(), path = this.nativeSavePath();
      fs.writeFileSync(`${path}.tmp`, text, 'utf8');
      fs.renameSync(`${path}.tmp`, path);
      this.refreshSave(); wx.showToast({ title: '快存已保存', icon: 'success' });
    } catch { wx.showToast({ title: '保存失败，请检查剩余空间', icon: 'none' }); }
  },
  restore() {
    const r = this.runtime!;
    if (!r.nes || !r.game || r.busy) return;
    this.pause();
    const previous = r.nes.toJSON();
    try {
      const saved = parseSave(wx.getFileSystemManager().readFileSync(this.nativeSavePath(), 'utf8') as string, r.game.sha256);
      r.nes.fromJSON(saved.state);
      // Restored snapshots must not hold any old controller inputs.
      for (const button of Object.values(buttons)) r.nes.buttonUp(1, button);
      r.frames = saved.frame;
      this.setData({ frames: r.frames, ready: true, error: '', menuOpen: false, status: '快存已读取 · 点击继续' });
    } catch {
      try { r.nes.fromJSON(previous); } catch (error) { this.fail(error); }
      wx.showToast({ title: '存档无效，未读取', icon: 'none' });
    }
  },
  fail(error: unknown) {
    if (this.runtime?.disposed) return;
    this.pause();
    this.setData({ ready: false, loading: false, error: error instanceof Error ? error.message : '运行失败，请重新加载。', status: '加载 / 运行失败' });
  },
  stickStart(event: WechatMiniprogram.TouchEvent) {
    const r = this.runtime!;
    if (r.running && r.stick) r.controls.startStick(event.changedTouches, r.stick);
  },
  stickMove(event: WechatMiniprogram.TouchEvent) {
    const r = this.runtime!;
    if (r.running && r.stick) r.controls.moveStick(event.touches, r.stick);
  },
  buttonStart(event: WechatMiniprogram.TouchEvent) {
    const input = event.currentTarget.dataset.input as Input;
    if (this.runtime?.running && Object.prototype.hasOwnProperty.call(buttons, input)) this.runtime.controls.press(event.changedTouches, input);
  },
  touchEnd(event: WechatMiniprogram.TouchEvent) { this.runtime?.controls.end(event.changedTouches); },
  swallow() {},
  copyReport() {
    const info = wx.getSystemInfoSync();
    wx.setClipboardData({ data: [
      '像素游乐室 · 原生 NES 验证', `核心：${CORE_BUILD}`, `存档格式：${PROFILE}`, `游戏：${this.data.title}`, `ROM SHA256：${this.data.sha}`,
      `设备：${info.model} / ${info.system}`, `微信：${info.version} / 基础库：${info.SDKVersion}`,
      `方向：${this.data.layout.wide ? '横屏' : '竖屏'} / 最近 FPS：${this.data.fps} / 帧数：${this.data.frames}`,
      `绘制：${this.data.rendererKind} / 提交 FPS：${this.data.drawFps} / ${this.data.rendererNote || '正常'}`,
      `模拟含音频：${this.data.coreMs} ms/帧 / 绘制提交：${this.data.drawMs} ms/次 / 最大回调间隔：${this.data.maxGapMs} ms`,
      `声音开关：${this.data.sound} / 音频断供次数：${this.runtime!.audio.underruns}`,
      `状态：${this.data.status} / 错误：${this.data.error || this.data.audioNote || '无'}`,
      `快存：${this.data.saveLabel || '无'}`,
    ].join('\n') });
  },
});
