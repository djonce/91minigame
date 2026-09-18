import type { Game } from '../../shared/types';
import { RuntimeAdapter, buttons, type Ejs423 } from '../runtime-adapter';
import { sha256 } from '../storage';
import { INPUT_KEYS, MAX_SNAPSHOT, netplayProfile, type InputFrame } from '../../shared/netplay';

// Pinned glue SHA from the unchanged core archive. Fail closed on an upgrade.
const GLUE_SHA = 'dba07936f4502e66cd1d31adfcea8102664c3c6d8fd947bf3c151a3c93e5e73c';
const MARKER = 'Module["pauseMainLoop"]=MainLoop.pause;';
const BRIDGE = `${MARKER}Module.netplayIterate=async()=>{if(Asyncify.currData)throw new Error("Core still executing");MainLoop.pause();try{MainLoop.runIter(MainLoop.func);if(Asyncify.currData)await Asyncify.whenDone();}finally{MainLoop.pause();}};`;

export class NetplayRuntime {
  readonly adapter = new RuntimeAdapter();
  profile = netplayProfile('nes-2pad');
  frame = 0;
  private engine!: Ejs423;
  private busy = false;
  private rawFrame = 0;
  async prepare(game: Game, progress: (message: string) => void) {
    const controller = game.netplay?.controller || 'nes-2pad';
    this.profile = netplayProfile(controller);
    await this.adapter.prepare(game, progress, { ready: (engine, fail) => {
      engine.checkStarted = () => {}; // Our Ready action unlocks iOS audio.
      const start = engine.startGame.bind(engine);
      engine.startGame = () => {
        const main = engine.Module.callMain.bind(engine.Module);
        // This RetroArch build initializes input devices independently of its
        // saved config. CLI device overrides set the actual core port types.
        engine.Module.callMain = args => main(['--device', `3:${controller === 'nes-four-score' ? 513 : 0}`, '--device', `4:${controller === 'nes-four-score' ? 513 : 0}`, ...args]);
        start();
      };
      const original = engine.initGameCore.bind(engine);
      engine.initGameCore = (js, wasm, thread) => {
        void (async () => {
          if (await sha256(js) !== GLUE_SHA) throw new Error('联机核心版本不匹配，请更新运行环境。');
          const source = new TextDecoder().decode(js);
          if (source.split(MARKER).length !== 2) throw new Error('联机核心接口校验失败。');
          // FCEUmm's explicit Gamepad subclass is 513, Auto is 1. P3/P4
          // enable Four Score; zero disconnects them for the two-pad profile.
          engine.retroarchOpts = [...(engine.retroarchOpts || []),
            { name: 'input_max_users', default: controller === 'nes-four-score' ? 4 : 2, isString: false },
            ...[3, 4].map(port => ({ name: `input_libretro_device_p${port}`, default: controller === 'nes-four-score' ? 513 : 0, isString: false })),
          ];
          original(new TextEncoder().encode(source.replace(MARKER, BRIDGE)), wasm, thread);
        })().catch(fail);
      };
      engine.startButtonClicked(engine.elements.parent.querySelector('.ejs_start_button')!);
    } });
    this.engine = this.adapter.netplayEngine;
    if (!this.engine.Module.netplayIterate) throw new Error('联机核心未安装。');
    // EJS pause and the Emscripten scheduler are separate. Enable execution,
    // cancel automatic scheduling, then invoke one completed iteration at a time.
    this.engine.Module._toggleMainLoop(1);
    this.engine.Module.pauseMainLoop();
    this.rawFrame = this.adapter.frame;
  }
  private async exclusive(work: () => Promise<void>) {
    if (this.busy) throw new Error('不能重入模拟器。');
    this.busy = true;
    try { await work(); } finally { this.busy = false; }
  }
  async step(inputs: InputFrame) {
    await this.exclusive(async () => {
      this.apply(inputs);
      const before = this.adapter.frame;
      if (before !== this.rawFrame) throw new Error('检测到模拟器在同步循环之外推进，已停止联机。');
      await this.engine.Module.netplayIterate!();
      if (this.adapter.frame !== before + 1) throw new Error(`模拟器没有精确推进一帧（${before} → ${this.adapter.frame}），请保持页面在前台。`);
      this.frame++;
      this.rawFrame = this.adapter.frame;
    });
  }
  private apply(inputs: InputFrame) {
    for (let port = 0; port < 4; port++) for (let bit = 0; bit < INPUT_KEYS.length; bit++) {
      this.engine.gameManager.simulateInput(port, buttons[INPUT_KEYS[bit]], (inputs[port] >>> bit) & 1);
    }
  }
  capture() {
    if (this.busy) throw new Error('等待当前帧执行完成后再保存。');
    return this.readState();
  }
  private readState() {
    // save_state_info allocates the serialized payload. Frequent netplay hashes
    // must release it; the upstream UI helper only copies it and leaks this block.
    const [lengthText, pointerText, ok] = this.engine.gameManager.functions.saveStateInfo().split('|');
    const length = Number(lengthText), pointer = Number(pointerText), module = this.engine.Module;
    if (ok !== '1' || !Number.isSafeInteger(length) || length < 64 || length > MAX_SNAPSHOT || !Number.isSafeInteger(pointer) || pointer <= 0 || pointer + length > module.HEAPU8.length) throw new Error('核心返回了无效的联机状态。');
    try { return module.HEAPU8.slice(pointer, pointer + length); } finally { module._free(pointer); }
  }
  async restore(state: Uint8Array, frame: number) {
    await this.exclusive(async () => {
      this.apply([0, 0, 0, 0]);
      this.engine.gameManager.loadState(state);
      // The load is queued at the end of an iteration. Await Asyncify before
      // reading Wasm memory; otherwise re-entry can corrupt the core stack.
      for (let attempt = 0; attempt < 8; attempt++) {
        await this.engine.Module.netplayIterate!();
        const actual = this.readState();
        if (actual.length === state.length && actual.every((value, i) => value === state[i])) { this.frame = frame; this.rawFrame = this.adapter.frame; return; }
      }
      throw new Error('未能恢复一致的联机状态。');
    });
  }
  async unlockAudio() { await this.engine.Module.AL?.currentCtx?.audioCtx?.resume(); }
  volume(value: number) { this.adapter.volume(value); }
  dispose() { this.adapter.dispose(); this.engine?.Module.pauseMainLoop(); }
}
