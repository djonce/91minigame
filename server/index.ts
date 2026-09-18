import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { entries, loadGame, root, runtimeRoot, runtimeManifest } from './catalog.js';
import { mime, staticAssets } from './static.js';

const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
const assets = production ? await staticAssets(resolve(root, 'dist')) : undefined;
const vite = production ? undefined : await (await import('vite')).createServer({
  root,
  server: { middlewareMode: true, hmr: { port: port + 1 }, fs: {
    strict: true, allow: [root], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/*.nes'],
  } },
  appType: 'mpa',
});
function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  try {
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(request.method || '')) return json(response, { error: 'METHOD_NOT_ALLOWED' }, 405);
      const runtime = await runtimeManifest();
      if (url.pathname === '/api/runtime') return json(response, { ready: Boolean(runtime), runtime });
      if (url.pathname === '/api/health') return json(response, { ok: Boolean(runtime), mode: production ? 'production' : 'local', runtimeReady: Boolean(runtime), release: process.env.RELEASE_ID || 'development' }, runtime ? 200 : 503);
      const localEntries = await entries();
      if (url.pathname === '/api/games') {
        const result = await Promise.allSettled(localEntries.map(entry => loadGame(entry, runtime)));
        return json(response, {
          games: result.flatMap(item => item.status === 'fulfilled' ? [item.value.game] : []),
          notices: result.flatMap(item => item.status === 'rejected' ? [production ? '有一张卡带暂时无法读取，请稍后再试。' : '有一份本地 ROM 无法读取，请检查 ROM_PATH 或 .local/games.json。'] : []),
        });
      }
      const match = url.pathname.match(/^\/api\/(games|roms)\/([^/]+)$/);
      if (match) {
        const entry = localEntries.find(item => item.id === decodeURIComponent(match[2]));
        if (!entry) return json(response, { error: 'GAME_NOT_FOUND' }, 404);
        const { game, bytes } = await loadGame(entry, runtime);
        if (match[1] === 'games') return json(response, game);
        if (url.searchParams.get('sha') !== game.sha256) return json(response, { error: 'ROM_VERSION_CHANGED', message: '游戏文件已更换，请返回列表重新打开。' }, 409);
        response.writeHead(200, {
          'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length,
          'Cache-Control': 'private, max-age=0, must-revalidate', 'ETag': `"${game.sha256}"`,
          'Content-Disposition': `inline; filename="${game.id}.nes"`,
        });
        return response.end(request.method === 'HEAD' ? undefined : bytes);
      }
      return json(response, { error: 'NOT_FOUND' }, 404);
    }
    const prefix = '/runtime/emulatorjs/4.2.3/';
    if (url.pathname.startsWith(prefix)) {
      if (!['GET', 'HEAD'].includes(request.method || '')) return json(response, { error: 'METHOD_NOT_ALLOWED' }, 405);
      const relativePath = decodeURIComponent(url.pathname.slice(prefix.length));
      const path = resolve(runtimeRoot, relativePath);
      if (!path.startsWith(runtimeRoot + sep)) return json(response, { error: 'NOT_FOUND' }, 404);
      const runtime = await runtimeManifest();
      const expected = runtime?.files.find(file => file.path === relativePath);
      if (!expected) return json(response, { error: 'RUNTIME_FILE_NOT_FOUND', message: '运行文件缺失，请执行 pnpm runtime:setup。' }, 404);
      const bytes = await readFile(path);
      if (bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) return json(response, { error: 'RUNTIME_INTEGRITY_FAILED' }, 409);
      if (request.headers['if-none-match'] === `"${expected.sha256}"`) { response.writeHead(304, { ETag: `"${expected.sha256}"` }); return response.end(); }
      response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'text/plain', 'Content-Length': bytes.length,
        'Cache-Control': 'public, max-age=0, must-revalidate', 'ETag': `"${expected.sha256}"` });
      if (request.method === 'HEAD') return response.end();
      return response.end(bytes);
    }
    if (assets) {
      if (!['GET', 'HEAD'].includes(request.method || '')) return json(response, { error: 'METHOD_NOT_ALLOWED' }, 405);
      const asset = assets.get(url.pathname);
      if (asset) {
        const headers = { 'Content-Type': asset.contentType, 'Cache-Control': asset.cacheControl, ETag: asset.etag };
        if (request.headers['if-none-match'] === asset.etag) { response.writeHead(304, headers); return response.end(); }
        response.writeHead(200, { ...headers, 'Content-Length': asset.bytes.length });
        return response.end(request.method === 'HEAD' ? undefined : asset.bytes);
      }
      // WeChat domain verification files can be installed separately from releases.
      if (/^\/MP_verify_[A-Za-z0-9]+\.txt$/.test(url.pathname) && process.env.VERIFICATION_DIR) {
        try {
          const bytes = await readFile(resolve(process.env.VERIFICATION_DIR, url.pathname.slice(1)));
          if (bytes.length > 4096) return json(response, { error: 'INVALID_VERIFICATION_FILE' }, 400);
          response.writeHead(200, { 'Content-Type': mime['.txt'], 'Cache-Control': 'no-cache', 'Content-Length': bytes.length });
          return response.end(request.method === 'HEAD' ? undefined : bytes);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      return json(response, { error: 'NOT_FOUND' }, 404);
    }
    vite!.middlewares(request, response, () => json(response, { error: 'NOT_FOUND' }, 404));
  } catch (error) {
    if (response.headersSent) { response.destroy(); return; }
    const message = error instanceof Error ? error.message : '请求失败';
    console.error('[api]', message);
    json(response, { error: 'RESOURCE_ERROR', message: production ? '资源暂不可用，请稍后重试。' : '本地资源无法读取，请检查终端日志。' }, error instanceof URIError ? 400 : 500);
  }
});
server.listen(port, host, () => { const address = server.address(); console.log(`像素游乐室 (${production ? 'production' : 'development'}) http://${host}:${typeof address === 'object' && address ? address.port : port}`); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
  server.close(() => { void (vite?.close() || Promise.resolve()).then(() => process.exit(0)); });
  server.closeIdleConnections();
});
