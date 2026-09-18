import { createHash, randomBytes } from 'node:crypto';
import { FRAME_WINDOW, HASH_INTERVAL, MAX_PARTICIPANTS, MAX_SNAPSHOT, netplayProfile, NETPLAY_VERSION, isHash, isInteger, type ClientMessage, type InputFrame, type NetplayGame, type RoomView, type ServerMessage } from '../shared/netplay.js';

export interface Peer { send(message: ServerMessage): void; close(): void }
interface Member { id: string; token: string; seat: number | null; peer?: Peer; ready: boolean; loaded: boolean }
interface Room {
  code: string; owner: string; game: NetplayGame; epoch: number; phase: RoomView['phase']; reason?: string;
  members: Member[]; frame: number; inputs: Map<number, Map<string, number>>;
  hashes: Map<number, Map<string, string>>; checked: number; snapshot?: { state: string; hash: string };
  history: Map<number, InputFrame>;
  touched: number; disconnected?: number; loadingSince?: number; resyncs: number;
}
const id = () => randomBytes(16).toString('hex');
export class NetplayRooms {
  private rooms = new Map<string, Room>();
  private connections = new Map<Peer, { room: Room; member: Member }>();
  constructor(private game: (id: string) => Promise<NetplayGame | undefined>, private now = Date.now) {}
  private view(room: Room): RoomView {
    return { code: room.code, epoch: room.epoch, phase: room.phase, game: room.game, owner: room.owner, frame: room.frame, reason: room.reason,
      members: room.members.map(m => ({ id: m.id, seat: m.seat, connected: Boolean(m.peer), ready: m.ready })) };
  }
  private broadcast(room: Room, message: ServerMessage) { for (const member of room.members) member.peer?.send(message); }
  private update(room: Room) { this.broadcast(room, { type: 'room', room: this.view(room) }); }
  private error(peer: Peer, message: string) { peer.send({ type: 'error', message }); }
  private welcome(peer: Peer, room: Room, member: Member) {
    if (!room.members.includes(member)) room.members.push(member);
    member.peer = peer; this.connections.set(peer, { room, member }); room.touched = this.now();
    peer.send({ type: 'welcome', memberId: member.id, token: member.token, room: this.view(room) }); this.update(room);
  }
  async receive(peer: Peer, value: unknown) {
    if (!value || typeof value !== 'object' || !('type' in value)) return this.error(peer, '无效的消息。');
    const message = value as ClientMessage;
    const connection = this.connections.get(peer);
    if (!connection) {
      if (!['create', 'join', 'reconnect'].includes(message.type)) return this.error(peer, '请先加入房间。');
      if (!('version' in message) || message.version !== NETPLAY_VERSION) return this.error(peer, '联机版本不同，请刷新页面。');
      if (message.type === 'create') {
        if (this.rooms.size >= 32 || typeof message.gameId !== 'string') return this.error(peer, '暂时无法创建房间。');
        const game = await this.game(message.gameId);
        if (!game || game.profile !== netplayProfile(game.controller) || !isInteger(game.players, 2, 4) || (game.players > 2 && game.controller !== 'nes-four-score')) return this.error(peer, '这款游戏尚未开放联机验证。');
        let code: string; do { code = randomBytes(5).toString('hex').toUpperCase(); } while (this.rooms.has(code));
        const member: Member = { id: id(), token: id(), seat: 0, ready: false, loaded: false };
        const room: Room = { code, game, owner: member.id, epoch: 0, phase: 'lobby', members: [member], frame: 0, inputs: new Map(), hashes: new Map(), history: new Map(), checked: 0, touched: this.now(), resyncs: 0 };
        this.rooms.set(code, room); return this.welcome(peer, room, member);
      }
      if (message.type !== 'join' && message.type !== 'reconnect') return;
      const room = typeof message.code === 'string' && this.rooms.get(message.code.toUpperCase());
      if (!room || room.phase === 'ended') return this.error(peer, '房间不存在或已经结束。');
      if (message.type === 'reconnect') {
        const member = room.members.find(m => m.token === message.token);
        if (!member || member.peer) return this.error(peer, '重连凭据失效或已在其他页面使用。');
        if (!isInteger(message.frame, Math.max(0, room.frame - HASH_INTERVAL * 2), room.frame)) return this.error(peer, '断线时间过长，无法恢复本局。');
        const replay: Extract<ServerMessage, { type: 'frame' }>[] = [];
        if (message.epoch === room.epoch) for (let frame = message.frame; frame < room.frame; frame++) {
          const inputs = room.history.get(frame);
          if (!inputs) return this.error(peer, '缺少恢复帧，请重新建房。');
          replay.push({ type: 'frame', epoch: room.epoch, frame, inputs });
        }
        else if (member.id === room.owner && message.frame !== room.frame) return this.error(peer, '房主恢复进度失效，请重新建房。');
        member.ready = false; member.loaded = false; member.token = id();
        this.welcome(peer, room, member);
        for (const frame of replay) peer.send(frame);
        return;
      }
      if (room.phase !== 'lobby') return this.error(peer, '游戏已开始，请等待下一局。');
      if (room.members.length >= MAX_PARTICIPANTS) return this.error(peer, '房间已满（最多三位参与者）。');
      if (typeof message.spectator !== 'boolean') return this.error(peer, '请选择参与方式。');
      const seat = message.spectator ? null : Array.from({ length: room.game.players }, (_, i) => i).find(i => !room.members.some(m => m.seat === i));
      if (seat === undefined) return this.error(peer, `本游戏最多 ${room.game.players} 位玩家，请选择观战。`);
      return this.welcome(peer, room, { id: id(), token: id(), seat, ready: false, loaded: false });
    }
    const { room, member } = connection;
    if (message.type === 'leave') { this.disconnect(peer, true); return; }
    if (room.phase === 'ended') return;
    room.touched = this.now();
    switch (message.type) {
      case 'ready':
        if (message.profile !== room.game.profile || message.sha256 !== room.game.sha256) return this.error(peer, 'ROM 或模拟器配置与房间不同。');
        member.ready = true; this.update(room); break;
      case 'start':
      case 'resume': {
        if (member.id !== room.owner) return this.error(peer, '只有房主可以开始或重新同步。');
        if ((message.type === 'start' && room.phase !== 'lobby') || (message.type === 'resume' && room.phase !== 'paused')) return;
        if (room.members.filter(m => m.seat !== null).length < 2 || room.members.some(m => !m.peer || !m.ready)) return this.error(peer, '需要至少两位玩家，且所有参与者均准备完成。');
        room.epoch++; room.phase = 'loading'; room.reason = undefined; room.inputs.clear(); room.hashes.clear(); room.checked = room.frame;
        room.snapshot = undefined; room.history.clear(); room.loadingSince = this.now();
        for (const m of room.members) m.loaded = false;
        this.update(room); member.peer?.send({ type: 'need-snapshot', epoch: room.epoch, frame: room.frame }); break;
      }
      case 'snapshot': {
        if (member.id !== room.owner || room.phase !== 'loading' || message.epoch !== room.epoch || room.snapshot) return;
        if (typeof message.state !== 'string' || message.state.length > Math.ceil(MAX_SNAPSHOT / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.state) || !isHash(message.hash)) return this.error(peer, '无效的联机快照。');
        const bytes = Buffer.from(message.state, 'base64');
        if (bytes.length < 64 || bytes.length > MAX_SNAPSHOT || bytes.toString('base64') !== message.state || createHash('sha256').update(bytes).digest('hex') !== message.hash) return this.error(peer, '联机快照校验失败。');
        room.snapshot = { state: message.state, hash: message.hash };
        this.broadcast(room, { type: 'load', epoch: room.epoch, frame: room.frame, ...room.snapshot }); break;
      }
      case 'loaded':
        if (room.phase !== 'loading' || message.epoch !== room.epoch || !room.snapshot) return;
        if (message.hash !== room.snapshot.hash) return this.desync(room, '恢复状态不一致，请重新同步。');
        member.loaded = true;
        this.finishLoading(room); break;
      case 'input': {
        if (member.seat === null) return this.error(peer, '观战者不能发送操作。');
        if (room.phase !== 'playing' || message.epoch !== room.epoch) return;
        if (!isInteger(message.frame, room.frame, room.frame + FRAME_WINDOW) || !isInteger(message.buttons, 0, 255)) return this.error(peer, '输入帧超出允许范围。');
        const inputs = room.inputs.get(message.frame) || new Map<string, number>();
        if (inputs.has(member.id) && inputs.get(member.id) !== message.buttons) return this.desync(room, '收到冲突的输入，请重新同步。');
        inputs.set(member.id, message.buttons); room.inputs.set(message.frame, inputs); this.flush(room); break;
      }
      case 'hash': {
        if (room.phase !== 'playing' || message.epoch !== room.epoch) return;
        if (!isHash(message.hash) || !isInteger(message.frame, Math.max(0, room.frame - HASH_INTERVAL * 2), room.frame) || message.frame % HASH_INTERVAL !== 0) return this.error(peer, '无效的状态校验。');
        const hashes = room.hashes.get(message.frame) || new Map<string, string>();
        if (hashes.has(member.id) && hashes.get(member.id) !== message.hash) return this.desync(room, '状态校验发生冲突。');
        hashes.set(member.id, message.hash); room.hashes.set(message.frame, hashes);
        const players = room.members.filter(m => m.seat !== null);
        const expected = hashes.get(room.owner);
        if (expected && players.some(m => hashes.has(m.id) && hashes.get(m.id) !== expected)) return this.desync(room, '游戏状态不一致，已暂停。请房主重新同步。');
        if (expected) for (const observer of [...room.members]) {
          if (observer.seat === null && observer.peer && hashes.has(observer.id) && hashes.get(observer.id) !== expected) {
            const observerPeer = observer.peer;
            this.error(observerPeer, '观战状态不一致，请等待下一局。'); this.disconnect(observerPeer, true); observerPeer.close();
          }
        }
        if (players.every(m => hashes.has(m.id))) room.checked = Math.max(room.checked, message.frame);
        for (const key of room.hashes.keys()) if (key < room.frame - HASH_INTERVAL * 2) room.hashes.delete(key);
        this.flush(room); break;
      }
      case 'pause':
        if (member.seat !== null && (room.phase === 'playing' || room.phase === 'loading')) this.pause(room, message.reason === 'background' ? '有玩家离开页面，等待返回后由房主继续。' : message.reason === 'error' ? '有玩家的模拟器发生异常，请重新同步。' : '玩家暂停了游戏。');
        break;
      default: this.error(peer, '不支持的房间操作。');
    }
  }
  private finishLoading(room: Room) {
    if (room.phase !== 'loading' || !room.snapshot || !room.members.every(m => m.peer && m.loaded)) return;
    room.phase = 'playing'; room.disconnected = undefined; room.loadingSince = undefined; room.snapshot = undefined;
    this.update(room); this.broadcast(room, { type: 'go', epoch: room.epoch, frame: room.frame, seats: room.members.flatMap(m => m.seat === null ? [] : [m.seat]) });
  }
  private flush(room: Room) {
    if (room.phase !== 'playing') return;
    const players = room.members.filter(m => m.seat !== null);
    // Confirm a checkpoint before allowing further frames. Spectators do not
    // participate in this barrier and cannot slow players down.
    while (!(room.frame % HASH_INTERVAL === 0 && room.frame > room.checked)) {
      const frame = room.inputs.get(room.frame);
      if (!frame || !players.every(m => frame.has(m.id))) break;
      const inputs: InputFrame = [0, 0, 0, 0];
      for (const member of players) inputs[member.seat!] = frame.get(member.id)!;
      room.inputs.delete(room.frame);
      room.history.set(room.frame, inputs);
      room.history.delete(room.frame - HASH_INTERVAL * 2);
      this.broadcast(room, { type: 'frame', epoch: room.epoch, frame: room.frame++, inputs });
    }
  }
  private pause(room: Room, reason: string) { room.phase = 'paused'; room.reason = reason; room.inputs.clear(); room.loadingSince = undefined; this.update(room); }
  private desync(room: Room, reason: string) { if (++room.resyncs > 3) this.end(room, '本局反复出现状态分歧，请重新建房检查运行环境。'); else this.pause(room, reason); }
  private end(room: Room, reason: string) { room.phase = 'ended'; room.reason = reason; room.inputs.clear(); room.hashes.clear(); room.snapshot = undefined; room.touched = this.now(); this.update(room); }
  disconnect(peer: Peer, voluntary = false) {
    const connection = this.connections.get(peer); if (!connection) return;
    const { room, member } = connection; this.connections.delete(peer); member.peer = undefined; member.ready = false;
    if (room.phase === 'ended') return;
    if (voluntary && member.id === room.owner) return this.end(room, '房主已退出。');
    if (member.seat === null || (voluntary && room.phase === 'lobby')) { room.members = room.members.filter(m => m !== member); this.update(room); this.finishLoading(room); return; }
    room.disconnected = this.now();
    if (room.phase !== 'lobby') this.pause(room, '玩家连接中断，席位保留 30 秒。'); else this.update(room);
  }
  sweep() {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      if (room.phase === 'ended') { if (now - room.touched > 60000) { for (const member of room.members) member.peer?.close(); this.rooms.delete(code); } continue; }
      if (room.disconnected !== undefined && room.members.some(m => !m.peer) && now - room.disconnected > 30000) this.end(room, '玩家重连超时，房间已结束。');
      else if (room.loadingSince !== undefined && now - room.loadingSince > 30000) this.pause(room, '同步超时，请检查连接后重试。');
      else if (now - room.touched > 15 * 60 * 1000) this.end(room, '房间长时间无操作，已结束。');
    }
  }
}
