# 本地开发说明

更新：2026-09-15。用户已确认开始开发，并将本轮范围限定为本地开发。之前的开发计划继续作为后续微信真机与服务端阶段的路线，本轮不等待正式域名。

## 目录与职责

| 路径 | 职责 |
| --- | --- |
| `index.html`、`src/library.ts` | 游戏库、本地存档列表、缓存设置 |
| `player.html`、`src/player.ts` | 独立播放器、交互状态、存档槽、备份导入导出 |
| `src/gamepad.ts`、`src/player-layout.ts` | 连续八方向触控、多输入源释放、可用视口布局与设备偏好 |
| `src/runtime-adapter.ts` | 固定版本 EmulatorJS 适配、按键、截图、恢复确认 |
| `src/storage.ts` | IndexedDB、ROM 摘要校验、存档完整性、缓存 |
| `shared/nes.ts`、`shared/save-file.ts` | 文件头与备份格式检查 |
| `server/` | 本地目录 API、受控 ROM 读取、运行时文件交付 |
| `miniprogram/` | 微信原生列表、详情、播放器容器、设置 |
| `scripts/` | 固定运行时安装/校验、管理员本地 ROM 登记 |
| `config/runtime-lock.json` | 46 个运行文件的长度和 SHA-256 |
| `tests/` | 文件边界测试与真实 Chrome 集成测试 |

本地服务使用 Node HTTP + Vite middleware，多页面导航使每次退出播放器后浏览器销毁对应模拟器实例。页面隐藏、失焦与离开时释放全部按键，后台不会主动继续运行。

## 实际本地接口

| 方法与路径 | 返回 |
| --- | --- |
| `GET /api/health` | 本地服务状态 |
| `GET /api/runtime` | 运行时文件就绪情况与锁定清单 |
| `GET /api/games` | 注册游戏列表与读取异常提示 |
| `GET /api/games/:id` | 文件头检查、ROM SHA-256、大小、运行配置 ID |
| `GET /api/roms/:id?sha=...` | 注册文件的原始字节；摘要不匹配返回 409 |
| `GET /runtime/emulatorjs/4.2.3/:path` | 清单中的运行文件；每次校验长度和摘要 |

API 仅支持读取。未来文档中的登录、启动票据、云端存档与后台上传接口尚未实现。本地登记通过 CLI 和 `.local/games.json` 完成。

前端收到 ROM 后再次计算 SHA-256，传入 EmulatorJS 的是已验证的 `File`，不是未经验证的另一条下载地址。浏览器缓存命中同样会校验摘要。元数据与原文件之间发生变化时，旧摘要请求会失败，用户返回目录重新打开。

## 运行时锁定

- 前端：EmulatorJS 4.2.3。
- 核心：FCEUmm，`legacy-single-thread`，关闭线程和 WebGL2 核心选择。
- 构建报告时间：2025-06-14 17:55:31 UTC 至 17:56:45 UTC。
- 核心 SHA-256：`f1054b094e7149fd6278485bc1b2e51ff75c5259048ddb1134171e53d651f239`。
- 本地配置 ID：`ejs423-fceumm-f1054b094e7149fd`。
- 安装来自官方 tag 与固定版本 CDN；现有锁定文件不会被安装脚本静默覆盖。

本机 localhost 下，EmulatorJS 自动查询公共 CDN 的版本更新。适配器只将这一条确切的版本查询重定向到本地已锁定 `version.json`。正常启动全程资源请求均来自本机，浏览器测试对此有断言。ROM 与核心没有嵌入页面 JS。

运行文件来自 [EmulatorJS 4.2.3 源码](https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3) 和 [官方固定版本分发](https://emulatorjs.org/docs/cdn/)。安装保留了上游 LICENSE，来源及使用边界见 [第三方说明](../THIRD_PARTY_NOTICES.md)。

## 固定版本适配中的实测问题

业务代码只调用 `RuntimeAdapter`。公开配置与 `EJS_onGameStart` 负责装载；以下内部接口集中在适配器，升级版本时必须回归，不能随意替换 CDN 版本：

| 接口 | 用途与处理 |
| --- | --- |
| `gameManager.simulateInput` | libretro NES 按键；A=8、B=0、Select=2、Start=3、方向=4–7 |
| `pause` / `play` / `setVolume` | 暂停、恢复、静音；点击开始时恢复 AudioContext |
| `gameManager.getState` | 复制完整即时状态，写入成功后才提示保存成功 |
| `gameManager.loadState` | 底层会排队恢复；暂停时驱动核心处理任务，重新序列化逐字节比较，确认一致后才提示读取成功 |
| `functions.screenshot` + `FS.readFile` | 读取核心 PNG；采用有界等待，同一帧复用截图 |

实际 4.2.3 的高级截图接口在 `retroarch + upscale=1` 参数下不回调。WebGL canvas 在页面合成后也可能读出黑色，因此使用核心 PNG。连续暂停截图时，同帧重复请求可能不生成新文件，适配器缓存该帧截图。暂停画面使用独立图片展示，旋转时不会因 canvas 尺寸重建而变黑。

存档恢复验证限定在锁定核心和匹配 ROM 上。失败或超时会保留本机存档并显示错误。此逻辑已用提供的样本测试；更换核心需重新检验序列化与恢复行为。

## 存档与缓存

IndexedDB 数据库 `pixel-room-v1` 分为 `saves`、`roms` 两个 object store。存档键为 `ROM SHA-256 : runtimeProfileId : slot`，其中槽为 `quick`、`manual-1` 至 `manual-3`。

每份存档含完整状态字节、SHA-256、时间、标题、运行配置 ID 和可选 PNG。备份是 `pixel-room-save` 版本 1 JSON，只带状态二进制的 Base64 和版本信息，不包含 ROM。导入需匹配 ROM、核心和状态摘要，覆盖快存前由页面确认。手动槽覆盖也有确认。

这里只保存到当前浏览器，没有云端同步、后台自动快存或完全离线首页。ROM 缓存丢失时重新读取文件；清理 ROM 缓存不动存档。浏览器清理站点数据会删除本地记录。

## 后续接入

1. 核实可用于产品的 AppID、主体、类目、web-view 和 HTTPS 业务域名；当前开发者工具调试配置已保留。
2. 将 H5/API/runtime 按同源 HTTPS 路由部署，替换 `miniprogram/config.ts`；生产工程开启合法域名校验。
3. 完成 iOS/Android 微信真机音频、触控、切后台、存储以及 20 分钟运行测试。
4. 再实施登录、启动票据、管理员内容发布、云端存档与回退机制。
