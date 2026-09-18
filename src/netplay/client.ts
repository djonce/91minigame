import { HASH_INTERVAL, INPUT_DELAY, MAX_SNAPSHOT, NETPLAY_VERSION, type ClientMessage, type RoomView, type ServerMessage } from '../../shared/netplay';
import type { NetplayRuntime } from './runtime';
import { sha256 } from '../storage';

const encode = (bytes: Uint8Array) => {
  let result = ''; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
};
export class NetplayClient {
  room?: RoomView;
  memberId = '';
  buttons = 0;
  private socket?: WebSocket;
  private token?: string;
  private chain = Promise.resolve();
  private queued = 0;
  private epoch = 0;
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private frames = 0;
  receivedBytes = 0;
  sentBytes = 0;
  constructor(private options: {
    runtime: NetplayRuntime;
    prepare(room: RoomView): Promise<void>;
    update(): void;
    error(message: string): void;
  }) {}
  get seat() { return this.room?.members.find(m => m.id === this.memberId)?.seat; }
  get owner() { return this.memberId === this.room?.owner; }
  private send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    const text = JSON.stringify(message); this.sentBytes += new TextEncoder().encode(text).length; this.socket.send(text); return true;
  }
  connect(message: Extract<ClientMessage, { type: 'create' | 'join' | 'reconnect' }>) {
    if (this.socket?.readyState === WebSocket.OPEN) { this.send(message); return; }
    if (this.socket?.readyState === WebSocket.CONNECTING) return;
    this.closed = false;
    const socket = this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/netplay`);
    socket.onopen = () => this.send(message);
    socket.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > MAX_SNAPSHOT * 1.4 + 4096 || ++this.queued > 240) { this.fail('连接积压，请重新加入房间。'); socket.close(); return; }
      this.receivedBytes += new TextEncoder().encode(event.data).length;
      this.chain = this.chain.then(async () => {
        if (this.closed || socket !== this.socket) return;
        await this.handle(JSON.parse(event.data) as ServerMessage);
      }).catch(error => this.fail(error instanceof Error ? error.message : '联机状态异常。')).finally(() => { this.queued--; });
    };
    socket.onerror = () => this.options.error('连接失败，正在尝试重新连接。');
    socket.onclose = () => {
      this.buttons = 0;
      if (this.closed) return;
      if (this.room && this.token && this.seat != null && this.room.phase !== 'ended' && this.attempts++ < 8) {
        this.room = { ...this.room, phase: 'paused', reason: '连接中断，正在重新连接…' }; this.options.update();
        this.retry = setTimeout(() => this.connect({ type: 'reconnect', code: this.room!.code, token: this.token!, version: NETPLAY_VERSION, frame: this.options.runtime.frame, epoch: this.epoch }), 1000);
      } else {
        if (this.room) this.room = { ...this.room, phase: 'ended', reason: '连接已关闭。请等待下一局，或重新创建房间。' };
        this.options.error('连接已关闭，请刷新后重新加入。'); this.options.update();
      }
    };
  }
  create(gameId: string) { this.connect({ type: 'create', gameId, version: NETPLAY_VERSION }); }
  join(code: string, spectator: boolean) { this.connect({ type: 'join', code: code.trim().toUpperCase(), spectator, version: NETPLAY_VERSION }); }
  ready() { if (this.room) this.send({ type: 'ready', profile: this.options.runtime.profile, sha256: this.room.game.sha256 }); }
  start() { this.send({ type: 'start' }); }
  resume() { this.buttons = 0; this.send({ type: 'resume' }); }
  pause(reason: 'menu' | 'background' | 'error') { this.buttons = 0; this.send({ type: 'pause', reason }); }
  leave() { this.send({ type: 'leave' }); this.closed = true; clearTimeout(this.retry); this.socket?.close(); }
  private fail(message: string) { this.pause('error'); this.options.error(message); }
  private async handle(message: ServerMessage) {
    const runtime = this.options.runtime;
    switch (message.type) {
      case 'welcome':
        this.memberId = message.memberId; this.token = message.token; this.room = message.room; this.attempts = 0;
        this.options.update(); await this.options.prepare(message.room); this.options.update(); break;
      case 'room': this.room = message.room; this.options.update(); break;
      case 'need-snapshot': {
        if (!this.owner || runtime.frame !== message.frame) throw new Error('房主帧进度不一致，请结束房间后重试。');
        const bytes = runtime.capture();
        this.send({ type: 'snapshot', epoch: message.epoch, state: encode(bytes), hash: await sha256(bytes) }); break;
      }
      case 'load': {
        this.buttons = 0;
        if (!Number.isSafeInteger(message.frame) || message.frame < 0 || message.state.length > MAX_SNAPSHOT * 1.4) throw new Error('无效的恢复数据。');
        const bytes = Uint8Array.from(atob(message.state), char => char.charCodeAt(0));
        if (await sha256(bytes) !== message.hash) throw new Error('恢复数据校验失败。');
        await runtime.restore(bytes, message.frame); this.epoch = message.epoch;
        this.send({ type: 'loaded', epoch: message.epoch, hash: await sha256(runtime.capture()) }); break;
      }
      case 'go':
        if (runtime.frame !== message.frame || this.epoch !== message.epoch) throw new Error('开始帧不一致。');
        this.buttons = 0;
        if (this.seat != null) for (let i = 0; i < INPUT_DELAY; i++) this.send({ type: 'input', epoch: this.epoch, frame: message.frame + i, buttons: 0 });
        this.options.update(); break;
      case 'frame':
        if (this.epoch !== message.epoch || message.frame !== runtime.frame) throw new Error('联机帧不连续，请重新同步。');
        await runtime.step(message.inputs);
        if (runtime.frame % HASH_INTERVAL === 0) this.send({ type: 'hash', epoch: this.epoch, frame: runtime.frame, hash: await sha256(runtime.capture()) });
        if (this.seat != null) this.send({ type: 'input', epoch: this.epoch, frame: message.frame + INPUT_DELAY, buttons: document.hidden ? 0 : this.buttons });
        if (++this.frames % 30 === 0) this.options.update();
        break;
      case 'error': this.options.error(message.message); break;
    }
  }
}
