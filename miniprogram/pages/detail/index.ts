import { request, type LocalGame } from '../../services/api';
Page({
  data: { game: null as LocalGame | null, sizeLabel: '', error: '' },
  onLoad(query: Record<string, string | undefined>) { if (query.id) void this.load(query.id); else this.setData({ error: '缺少游戏信息，请返回游戏库。' }); },
  async load(id: string) {
    try { const game = await request<LocalGame>(`/api/games/${encodeURIComponent(id)}`); this.setData({ game, sizeLabel: `${Math.round(game.sizeBytes / 1024)} KB` }); }
    catch (error) { this.setData({ error: error instanceof Error ? error.message : '读取失败。' }); }
  },
  play() { if (this.data.game) wx.navigateTo({ url: `/pages/player/index?id=${encodeURIComponent(this.data.game.id)}` }); },
  netplay() { if (this.data.game?.netplay) wx.navigateTo({ url: `/pages/player/index?id=${encodeURIComponent(this.data.game.id)}&mode=netplay` }); },
});
