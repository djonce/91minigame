import { config } from '../../config';
import { playerUrl } from '../../services/api';
Page({
  data: { src: '', showWebView: false, error: '', local: config.mode === 'local' },
  onLoad(query: Record<string, string | undefined>) {
    if (!query.id) { this.setData({ error: '缺少游戏信息。' }); return; }
    const src = playerUrl(query.id, query.mode === 'netplay');
    if (config.mode === 'https' && !/^https:\/\//.test(src)) { this.setData({ error: '正式接入必须配置 HTTPS 播放器地址。' }); return; }
    this.setData({ src, showWebView: config.mode === 'https' });
  },
  copyLink() { wx.setClipboardData({ data: this.data.src }); },
  preview() { this.setData({ showWebView: true, error: '' }); },
  onError() { this.setData({ showWebView: false, error: '暂时无法打开播放器，请检查网络及小程序业务域名配置。也可以复制链接在浏览器中打开。' }); },
});
