import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { entries, loadGame, runtimeManifest } from './catalog.js';
import { MAX_SNAPSHOT, netplayProfile } from '../shared/netplay.js';
import { NetplayRooms, type Peer } from './netplay-rooms.js';

export function installNetplay(server: Server) {
  const rooms = new NetplayRooms(async id => {
    const entry = (await entries()).find(entry => entry.id === id); if (!entry) return;
    const { game } = await loadGame(entry, await runtimeManifest());
    if (!game.netplay || !game.available) return;
    return { gameId: game.id, sha256: game.sha256, runtimeProfileId: game.runtimeProfileId, profile: netplayProfile(game.netplay.controller), controller: game.netplay.controller, players: game.netplay.players, fps: game.netplay.fps };
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_SNAPSHOT * 1.4 + 4096, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/netplay') return; // Vite's separate HMR listener owns other paths.
    let allowed = false;
    try {
      const origin = new URL(request.headers.origin || '');
      const configured = process.env.NETPLAY_ORIGIN;
      allowed = configured ? origin.origin === configured : origin.host === request.headers.host && ['https:', 'http:'].includes(origin.protocol);
    } catch { /* Reject cross-site/anonymous WebSocket handshakes. */ }
    if (!allowed || wss.clients.size >= 96) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
  });
  wss.on('connection', socket => {
    let alive = true, count = 0, windowStart = Date.now(), pending = 0;
    const peer: Peer = {
      send(message) {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > MAX_SNAPSHOT * 2) { socket.close(1013, 'Slow connection'); return; }
        socket.send(JSON.stringify(message));
      },
      close() { socket.close(1000); },
    };
    socket.on('pong', () => { alive = true; });
    const ping = setInterval(() => { if (!alive) return socket.terminate(); alive = false; socket.ping(); }, 10000);
    ping.unref();
    let chain = Promise.resolve();
    socket.on('message', (data, binary) => {
      if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); count = 0; }
      if (binary || ++count > 180 || ++pending > 240) { socket.close(1008, 'Message limit'); return; }
      chain = chain.then(async () => {
        try { await rooms.receive(peer, JSON.parse(data.toString())); }
        catch { peer.send({ type: 'error', message: '联机请求失败，请重新加入。' }); }
        finally { pending--; }
      });
    });
    // A close frame may arrive before the queued "leave" message is handled.
    // Drain messages received on this authenticated connection before detaching.
    socket.on('close', () => { clearInterval(ping); void chain.finally(() => rooms.disconnect(peer)); });
    socket.on('error', () => socket.terminate());
  });
  const sweep = setInterval(() => rooms.sweep(), 1000); sweep.unref();
  return () => { clearInterval(sweep); for (const socket of wss.clients) socket.terminate(); wss.close(); };
}
