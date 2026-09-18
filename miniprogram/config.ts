// 服务器环境；本地联调时将 environment 改为 'local'。
const environment: 'local' | 'server' = 'server';
const environments = {
  local: { mode: 'local' as const, origin: 'http://127.0.0.1:5173' },
  server: { mode: 'https' as const, origin: 'https://minigames.19ba.cn' },
};
const selected = environments[environment];
export const config = {
  mode: selected.mode as 'local' | 'https',
  apiOrigin: selected.origin,
  playerOrigin: selected.origin,
};
