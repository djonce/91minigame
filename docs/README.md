**ROM 游戏播放器开发文档**

最新进展（2026-09-18）：手机界面优化及不传音视频的好友联机测试版已完成并部署至正式域名，当前版本 `20260918-120949`，包含 iOS 游戏区防误缩放与菜单防选中修复。参见[手机界面验收](mobile-ui-implementation.md)和[输入帧同步联机实现与验收](input-sync-netplay-implementation.md)。

联机补充（2026-09-18，方案阶段）：[三人联机与四席位扩展](multiplayer-architecture-plan.md)，区分三人同时操作、二人操作加观战和轮换，补充 ROM 限制、稳定席位、输入权限、带宽及三机验收。

已确认联机选型：[不传音视频的输入帧同步方案](input-sync-netplay-plan.md)。已实现逐帧核心适配、WSS 房间、双人＋观战和三人诊断验证；后续验收 iOS 微信多机及真实三人游戏，按实测需要增加回滚。

更新日期：2026-09-15。已确认游戏内容为 ROM，首个测试文件为用户提供的 NES 文件。已完成本地播放器和微信入口工程，并按新增要求将服务以 Docker 部署至阿里云。服务器与域名验收状态见部署说明。

| 阅读顺序 | 文档 | 内容 |
| --- | --- | --- |
| 1 | [开发计划](/Users/zebo/Documents/game-monitor/docs/rom-game-development-plan.md) | 产品范围、技术路线、模块职责、微信接入条件、里程碑与交付标准 |
| 2 | [ROM 与接口规范](/Users/zebo/Documents/game-monitor/docs/rom-package-and-api-spec.md) | 游戏清单、导入流程、运行时约定、服务端接口和存档版本规则 |
| 3 | [测试 ROM 检查与验收计划](/Users/zebo/Documents/game-monitor/docs/rom-test-plan.md) | 本地样本检查结果、文件头异常、核心验证顺序及真机测试矩阵 |

上述三份文档是已确认的 ROM 方向规划基线；本轮本地实现与后续微信/服务端阶段的边界见新增开发说明。原 [Cocos 技术调研](/Users/zebo/Documents/game-monitor/docs/wechat-game-technical-proposal.md) 与 [EmulatorJS 可行性补充](/Users/zebo/Documents/game-monitor/docs/emulatorjs-feasibility.md) 保留为调研记录；Cocos、自研游戏模块及其工期不再作为当前开发计划。

本地使用与验收：

- [启动说明](../README.md)
- [本地开发说明](local-development.md)
- [本地验收记录](local-test-results.md)
- [服务器部署与运维](deployment.md)
