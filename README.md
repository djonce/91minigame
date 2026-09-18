# 像素游乐室 · Pixel Room

ROM 游戏播放器、游戏资源服务与微信小程序入口。使用固定版本 EmulatorJS 4.2.3 / FCEUmm，游戏文件单独读取。当前接入用户提供的《赤色要塞》NES 原始文件。

服务器使用 Docker 部署，目标地址为 [minigames.19ba.cn](https://minigames.19ba.cn)。发布版本、HTTPS 验收状态与运维命令见 [服务器部署说明](docs/deployment.md)。

## 本地启动

需要 Node.js 20.11+、pnpm。首次准备：

```sh
pnpm install --frozen-lockfile
pnpm runtime:setup
pnpm dev
```

打开 [游戏库](http://127.0.0.1:5173) 或 [赤色要塞播放器](http://127.0.0.1:5173/player.html?game=nes-chise-yaosai)。当前电脑已经完成依赖和运行时下载。

默认按需读取 `/Users/zebo/Downloads/nes/赤色要塞.nes`，原始文件保持不变。更换默认文件：

```sh
ROM_PATH='/绝对路径/游戏.nes' pnpm dev
```

`.env.example` 是变量说明；启动命令读取进程环境变量，不会自动加载 `.env`。默认监听本机 `127.0.0.1:5173`。应始终使用同一个地址访问，`localhost` 与 `127.0.0.1` 的浏览器存档互相隔离。

## 使用

1. 在游戏库选择卡带，等待 ROM 和核心校验完成。
2. 点击「开始游戏」激活声音，再按 **Enter / START** 进入游戏。
3. 方向键移动，**Z = B，X = A，Shift = SELECT，Esc = 打开菜单/继续**。手机方向盘支持按住滑动、八方向和方向+A/B 多指组合；旋转手机自动调整横竖屏布局。
4. 点击「菜单」暂停游戏，使用快速存档或三个手动槽，或调整按键大小、左右布局和音量。存档写入本机 IndexedDB，可导出、导入 JSON 备份。点击「继续游戏」返回。

页面失去焦点时会暂停并释放按键，返回后点击继续。设置页清理游戏缓存时保留存档。本地存储不可用时仍可尝试游戏，保存失败会明确提示。

2026-09-18 手机界面优化已在本地实现，验收与真机待测项见 [手机界面优化记录](docs/mobile-ui-implementation.md)。本地改动尚未发布至线上域名；小程序播放器页已配置自动横竖屏，需要重新编译后生效。

## 添加独立 ROM

```sh
pnpm rom:add '/绝对路径/另一个游戏.nes' another-game '另一个游戏'
```

命令检查 NES 文件头并将路径登记到 `.local/games.json`；刷新游戏库即可加载，无需修改播放器。已登记条目的名称、文件路径可在该文件中编辑。每个 ID 必须唯一，只允许小写字母、数字和连字符。当前最多 100 个条目，单个 ROM 最大 16 MiB。登记不代表该游戏已通过核心兼容性测试。

`.local`、`.runtime`、ROM 和存档文件已加入忽略规则。ROM 只通过注册条目的专用 API 返回，Downloads 没有作为静态目录开放。

## 微信开发者工具

```sh
pnpm wechat:build
```

在开发者工具中导入本仓库目录，项目会从 `miniprogram/` 读取编译后的 JS、WXML 和 WXSS。当前电脑已成功打开工程，并在工具内验证了列表、详情及 web-view 播放器。保留了调试过程中工具写入的 `project.config.json` 配置。

支持 CLI 的环境也可执行 `pnpm wechat:open`。当前电脑的 CLI 服务端口关闭时，使用项目列表中的「导入」打开即可。

`miniprogram/config.ts` 默认使用 `https://minigames.19ba.cn`。本地联调时将 `environment` 改为 `'local'` 并重新执行 `pnpm wechat:build`。微信公众平台还需配置 request 合法域名与 web-view 业务域名，再完成 iOS/Android 微信真机验证。平台配置和域名校验文件的放置方式见部署说明。

## 检查与构建

```sh
pnpm check
pnpm test
pnpm runtime:verify
pnpm test:browser
pnpm test:production
pnpm build
```

浏览器测试使用已安装的 Google Chrome，自动启动本地服务或复用 5173 端口的服务，并使用独立的临时浏览器存储。原始样本摘要检查可通过 `TEST_ROM_PATH='/Users/zebo/Downloads/nes/赤色要塞.nes' pnpm test` 启用。

`pnpm build` 生成 H5 的 `dist/`、生产服务的 `build/` 和小程序 JS。`dist/` 仍依赖 `/api` 与 `/runtime` 路由，生产镜像一并提供这些路由。`pnpm release:package` 生成不含 ROM 的部署包，`pnpm test:deployed` 测试正式域名上的实际服务。

当前 API 提供游戏清单与资源下载；正式登录、云存档、网页管理后台尚未实现。存档保存在当前设备和站点下，从本地地址切换到正式域名时，请先导出存档，再到新地址导入。

实现细节见 [本地开发说明](docs/local-development.md)，验收见 [本地测试记录](docs/local-test-results.md)，后续路线见 [开发文档索引](docs/README.md)。
