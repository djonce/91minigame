import { request, type LocalGame } from '../../services/api';
Page({
  data: { games: [] as (LocalGame & { sizeLabel: string })[], loading: true, error: '' },
  onLoad() { void this.load(); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await request<{ games: LocalGame[]; notices: string[] }>('/api/games');
      this.setData({ games: result.games.map(game => ({ ...game, sizeLabel: `${Math.round(game.sizeBytes / 1024)} KB` })), error: result.notices.join(' ') });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '读取失败，请重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  openGame(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  settings() { wx.navigateTo({ url: '/pages/settings/index' }); },
});
