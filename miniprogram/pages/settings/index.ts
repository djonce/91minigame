import { config } from '../../config';
Page({ data: { origin: config.apiOrigin, local: config.mode === 'local' }, copyUrl() { wx.setClipboardData({ data: config.playerOrigin }); } });
