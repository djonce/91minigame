import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NetplayRooms, type Peer } from '../server/netplay-rooms.js';
import { netplayProfile, NETPLAY_VERSION, type ClientMessage, type RoomView, type ServerMessage } from '../shared/netplay.js';
class Client implements Peer {
  messages: ServerMessage[] = [];
  closed = false;
  send(message: ServerMessage) { this.messages.push(message); }
  close() { this.closed = true; }
  get welcome() { return this.messages.filter((m): m is Extract<ServerMessage, { type: 'welcome' }> => m.type === 'welcome').at(-1)!; }
  get room(): RoomView { return this.messages.flatMap(m => m.type === 'room' || m.type === 'welcome' ? [m.room] : []).at(-1)!; }
  frames() { return this.messages.filter(m => m.type === 'frame'); }
}
const NETPLAY_PROFILE = netplayProfile('nes-2pad');
const hash = 'a'.repeat(64);
const state = Buffer.alloc(128, 7);
const snapshot = { state: state.toString('base64'), hash: createHash('sha256').update(state).digest('hex') };
async function fixture(players = 2, observer = false) {
  let now = 1000;
  const controller = players > 2 ? 'nes-four-score' as const : 'nes-2pad' as const;
  const profile = netplayProfile(controller);
  const rooms = new NetplayRooms(async () => ({ gameId: 'test', sha256: hash, runtimeProfileId: 'fixed', profile, controller, players, fps: 60.0988 }), () => now);
  const clients = Array.from({ length: observer ? 3 : players }, () => new Client());
  const send = (i: number, m: ClientMessage) => rooms.receive(clients[i], m);
  await send(0, { type: 'create', gameId: 'test', version: NETPLAY_VERSION });
  const code = clients[0].room.code;
  for (let i = 1; i < clients.length; i++) await send(i, { type: 'join', code, spectator: observer && i === 2, version: NETPLAY_VERSION });
  const start = async () => {
    for (let i = 0; i < clients.length; i++) await send(i, { type: 'ready', sha256: hash, profile });
    await send(0, { type: 'start' });
    await send(0, { type: 'snapshot', epoch: clients[0].room.epoch, ...snapshot });
    for (let i = 0; i < clients.length; i++) await send(i, { type: 'loaded', epoch: clients[0].room.epoch, hash: snapshot.hash });
    assert.equal(clients[0].room.phase, 'playing');
  };
  return { rooms, clients, send, start, code, advance: (ms: number) => { now += ms; rooms.sweep(); } };
}
test('three fixed player seats commit only complete input frames and do not accept seat spoofing', async () => {
  const f = await fixture(3); await f.start();
  assert.deepEqual(f.clients[0].room.members.map(m => m.seat), [0, 1, 2]);
  await f.send(0, { type: 'input', epoch: 1, frame: 0, buttons: 1 });
  await f.send(1, { type: 'input', epoch: 1, frame: 0, buttons: 2 });
  assert.equal(f.clients[0].frames().length, 0);
  await f.rooms.receive(f.clients[2], { type: 'input', epoch: 1, frame: 0, buttons: 4, seat: 0 });
  for (const c of f.clients) assert.deepEqual(c.frames()[0], { type: 'frame', epoch: 1, frame: 0, inputs: [1, 2, 4, 0] });
  await f.send(1, { type: 'input', epoch: 1, frame: 99, buttons: 2 });
  assert.equal(f.clients[0].frames().length, 1);
});
test('ROM capacity and participant limit are distinct; spectators cannot inject input or block checkpoint', async () => {
  const f = await fixture(2, true); await f.start();
  assert.deepEqual(f.clients[0].room.members.map(m => m.seat), [0, 1, null]);
  await f.send(2, { type: 'input', epoch: 1, frame: 0, buttons: 255 });
  assert.equal(f.clients[2].messages.at(-1)?.type, 'error');
  for (let frame = 0; frame < 121; frame++) for (let i = 0; i < 2; i++) await f.send(i, { type: 'input', epoch: 1, frame, buttons: i });
  assert.equal(f.clients[0].frames().length, 120);
  for (let i = 0; i < 2; i++) await f.send(i, { type: 'hash', epoch: 1, frame: 120, hash });
  assert.equal(f.clients[0].frames().length, 121);
});
test('ROM mismatch, incomplete readiness, guest start and corrupt snapshots cannot start a session', async () => {
  const f = await fixture();
  await f.send(0, { type: 'ready', sha256: 'b'.repeat(64), profile: NETPLAY_PROFILE });
  await f.send(0, { type: 'start' }); assert.equal(f.clients[0].room.phase, 'lobby');
  await f.send(1, { type: 'start' }); assert.equal(f.clients[0].room.phase, 'lobby');
  for (let i = 0; i < 2; i++) await f.send(i, { type: 'ready', sha256: hash, profile: NETPLAY_PROFILE });
  await f.send(0, { type: 'start' });
  await f.send(0, { type: 'snapshot', epoch: 1, ...snapshot, hash });
  assert.equal(f.clients[0].messages.filter(m => m.type === 'load').length, 0);
  await f.send(0, { type: 'snapshot', epoch: 1, ...snapshot });
  await f.send(0, { type: 'loaded', epoch: 1, hash: snapshot.hash });
  assert.equal(f.clients[0].room.phase, 'loading');
});
test('desync pauses at the confirmed checkpoint; obsolete inputs cannot cross a new epoch', async () => {
  const f = await fixture(); await f.start();
  for (let frame = 0; frame < 120; frame++) for (let i = 0; i < 2; i++) await f.send(i, { type: 'input', epoch: 1, frame, buttons: 0 });
  await f.send(0, { type: 'hash', epoch: 1, frame: 120, hash });
  await f.send(1, { type: 'hash', epoch: 1, frame: 120, hash: 'b'.repeat(64) });
  assert.equal(f.clients[0].room.phase, 'paused');
  await f.send(0, { type: 'resume' }); assert.equal(f.clients[0].room.epoch, 2);
  await f.send(0, { type: 'snapshot', epoch: 2, ...snapshot });
  for (let i = 0; i < 2; i++) await f.send(i, { type: 'loaded', epoch: 2, hash: snapshot.hash });
  for (let i = 0; i < 2; i++) await f.send(i, { type: 'input', epoch: 1, frame: 120, buttons: 255 });
  assert.equal(f.clients[0].frames().length, 120);
});
test('reconnect preserves seat three, rotates credentials, and times out instead of remapping players', async () => {
  const f = await fixture(3); await f.start(); const previous = f.clients[1].welcome;
  f.rooms.disconnect(f.clients[1]); assert.equal(f.clients[0].room.phase, 'paused');
  const next = new Client(); await f.rooms.receive(next, { type: 'reconnect', code: f.code, token: previous.token, version: NETPLAY_VERSION, frame: 0, epoch: 1 });
  assert.equal(next.welcome.memberId, previous.memberId); assert.notEqual(next.welcome.token, previous.token);
  assert.deepEqual(next.room.members.map(m => m.seat), [0, 1, 2]);
  const intruder = new Client(); await f.rooms.receive(intruder, { type: 'reconnect', code: f.code, token: previous.token, version: NETPLAY_VERSION, frame: 0, epoch: 1 });
  assert.equal(intruder.messages.at(-1)?.type, 'error');
  f.rooms.disconnect(next); f.advance(30001); assert.equal(f.clients[0].room.phase, 'ended');
});
test('host exit ends the room; full room and active room reject new participants', async () => {
  const f = await fixture(2, true); const c = new Client();
  await f.rooms.receive(c, { type: 'join', code: f.code, spectator: true, version: NETPLAY_VERSION });
  assert.equal(c.messages.at(-1)?.type, 'error');
  await f.start(); await f.send(0, { type: 'leave' }); assert.equal(f.clients[1].room.phase, 'ended');
});

test('reconnecting owner receives committed frames it missed before sending a recovery snapshot', async () => {
  const f = await fixture(); await f.start(); const previous = f.clients[0].welcome;
  for (let frame = 0; frame < 5; frame++) for (let i = 0; i < 2; i++) await f.send(i, { type: 'input', epoch: 1, frame, buttons: i + frame });
  f.rooms.disconnect(f.clients[0]);
  const next = new Client();
  await f.rooms.receive(next, { type: 'reconnect', code: f.code, token: previous.token, version: NETPLAY_VERSION, frame: 2, epoch: 1 });
  assert.deepEqual(next.frames().map(m => m.frame), [2, 3, 4]);
  assert.deepEqual(next.frames()[0].inputs, [2, 3, 0, 0]);
  assert.equal(next.room.members.find(m => m.id === previous.memberId)?.seat, 0);
});

test('observer disconnect during snapshot barrier does not strand ready players', async () => {
  const f = await fixture(2, true);
  for (let i = 0; i < 3; i++) await f.send(i, { type: 'ready', sha256: hash, profile: NETPLAY_PROFILE });
  await f.send(0, { type: 'start' }); await f.send(0, { type: 'snapshot', epoch: 1, ...snapshot });
  for (let i = 0; i < 2; i++) await f.send(i, { type: 'loaded', epoch: 1, hash: snapshot.hash });
  f.rooms.disconnect(f.clients[2]);
  assert.equal(f.clients[0].room.phase, 'playing');
});

test('early observer mismatch is removed without pausing players; menu resumes have no desync budget', async () => {
  const f = await fixture(2, true); await f.start();
  for (let frame = 0; frame < 120; frame++) for (let i = 0; i < 2; i++) await f.send(i, { type: 'input', epoch: 1, frame, buttons: 0 });
  await f.send(2, { type: 'hash', epoch: 1, frame: 120, hash: 'b'.repeat(64) });
  await f.send(0, { type: 'hash', epoch: 1, frame: 120, hash });
  assert.equal(f.clients[2].closed, true); assert.equal(f.clients[0].room.phase, 'playing');
  for (let turn = 0; turn < 8; turn++) {
    await f.send(0, { type: 'pause', reason: 'menu' }); await f.send(0, { type: 'resume' });
    const epoch = f.clients[0].room.epoch;
    await f.send(0, { type: 'snapshot', epoch, ...snapshot });
    for (let i = 0; i < 2; i++) await f.send(i, { type: 'loaded', epoch, hash: snapshot.hash });
    assert.equal(f.clients[0].room.phase, 'playing');
  }
});
