import { config } from '../config';
export interface LocalGame { id: string; title: string; system: string; sizeBytes: number; sha256: string; description: string; available: boolean }
export function request<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => wx.request({
    url: config.apiOrigin + path, method: 'GET', timeout: 10000,
    success: response => response.statusCode === 200 ? resolve(response.data as T) : reject(new Error('游戏服务暂不可用，请稍后重试。')),
    fail: () => reject(new Error(config.mode === 'local'
      ? '连接不上本地服务。请先运行 pnpm dev，并允许开发者工具访问本地网络。'
      : '连接不上游戏服务，请检查网络、HTTPS 证书及小程序合法域名配置。')),
  }));
}
export function playerUrl(id: string) {
  return `${config.playerOrigin}/player.html?game=${encodeURIComponent(id)}&source=wechat`;
}
