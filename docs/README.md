**ROM 游戏播放器开发文档**

最新进展（2026-09-18）：用户已确认先开发手机界面优化，[实现与本地验收记录](mobile-ui-implementation.md)。[原交互与联机规划](mobile-experience-and-netplay-plan.md) 中的联机验证仍待确认，未进入开发。

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
