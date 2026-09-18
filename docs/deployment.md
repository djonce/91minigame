# 阿里云 Docker 部署

最近部署日期：2026-09-18。用户已追加确认「推送并部署起来」，通过 `ssh aliyun` 更新 `minigames.19ba.cn`。首次部署为 2026-09-15。

## 部署内容与当前状态

已部署游戏目录 API、受控 ROM 下载、H5 游戏库与手机播放器、EmulatorJS 4.2.3 固定运行资源，以及不传音视频的联机房间服务。各端本地模拟，服务器通过同域 WSS `/netplay` 汇总输入。资源 API 仍只读；房间状态只保存在内存中，容器重启结束现有对局。没有网页管理后台、账号登录或云存档。

当前发布：`20260918-120949`；Docker 容器健康检查通过，公网 HTTPS 健康接口已返回该版本。可访问[线上游戏库](https://minigames.19ba.cn)及[好友联机](https://minigames.19ba.cn/netplay.html?game=nes-chise-yaosai)。触控修复代码提交为 [`d2a277e`](https://github.com/djonce/91minigame/commit/d2a277e0bc6e7d173dc439259a6a34a552be1c28)，已推送 `main`。

| 项目 | 值 |
| --- | --- |
| 目标域名 | https://minigames.19ba.cn |
| SSH / 主机 | `ssh aliyun` / `120.55.88.226` |
| 部署根目录 | `/opt/minigames` |
| 当前代码目录 | `/opt/minigames/current`，指向 `releases/20260918-120949` |
| Compose 项目 / 容器 | `minigames` / `minigames-app` |
| 镜像 | `minigames:20260918-120949` |
| 容器环境 | Node.js 24.21.0，Debian bookworm slim，非 root 用户 |
| 容器监听 / 主机映射 | `8080` / `127.0.0.1:5178` |
| HTTPS 入口 | 既有 systemd Caddy，80/443，新增独立域名路由 |
| 证书 | 公网 HTTPS 校验通过，Caddy 管理正式证书并自动续期 |
| 游戏数据 | `/opt/minigames/data` → 容器 `/data`，只读挂载 |
| 健康接口 | `/api/health`，返回版本、运行模式和资源就绪状态 |

请求路径：浏览器或小程序 → Caddy HTTPS → `127.0.0.1:5178` → Docker 内 Node 服务。没有将容器端口开放到公网。已有其他站点和容器配置保持不变。

## 发布构建

本机安装依赖、准备运行资源后执行：

```sh
pnpm install --frozen-lockfile
pnpm runtime:setup
pnpm test:production
pnpm release:package
```

发布包路径、版本和 SHA-256 记录在 `.deploy/latest.json`。包中只有构建结果、锁定运行资源和部署配置，不包含 `node_modules`、开发源码、ROM 或存档。Mac 发布归档关闭扩展属性和 AppleDouble 元数据。

本次触控修复归档：`minigames-20260918-120949.tar.gz`（1,653,186 字节），SHA-256：

```text
13e666f7fa0af8e5676726c633d17f9c46b0bcd58f39bd3ebdd5ba0d2fb04f39
```

已在服务器核对摘要并通过 Docker 健康检查；上一版本 `20260918-111911` 保留供回滚。

上一联机版本归档：`minigames-20260918-111911.tar.gz`（1,652,637 字节），SHA-256：

```text
450e02ac2b5f6b7bc48dc8707fd7223816667e33723a7128e511f1d240717113
```

所有发布包均在服务器用 `sha256sum` 核对，不包含 ROM、存档、密钥或开发目录。首次版本 `20260915-105326` 的镜像和目录也仍保留；上述发布没有修改游戏数据和 Caddy 其他站点配置。

首次发布归档：`minigames-20260915-105326.tar.gz`，SHA-256：

```text
94d761b8c5dbcb0a1d874fd2e1430027e8806c0247e8fb85c6998d69a40689d7
```

Docker 使用按摘要固定的官方 Node 24 镜像；构建阶段执行 `npm install --omit=dev --ignore-scripts --no-package-lock`，安装固定版本 `ws@8.21.3`，因此首次构建此层需访问 npm 注册表。运行容器不执行依赖安装。镜像构建时再次验证 46 个运行资源的 SHA-256。应用只读运行，设置 512 MiB 内存、1 CPU、100 进程上限；日志每份最多 10 MiB、保留 3 份。配置了重启策略与容器健康检查；健康检查失败本身不会自动重启进程。

## 更新与回滚

将新版本归档上传到 `/opt/minigames/incoming`，核对 `.deploy/latest.json` 中的 SHA-256，再解压到新的 `releases/版本号` 目录。版本号格式为 UTC `YYYYMMDD-HHMMSS`；已发布目录不要覆盖。

例如首次发布的激活命令为：

```sh
ssh aliyun 'bash /opt/minigames/releases/20260915-105326/deploy/activate.sh 20260915-105326'
```

更新时将上述两个版本号换成新版本。脚本只操作 Compose 项目 `minigames`：构建镜像、启动并等待健康，成功后更新 `current` 软链接和 `current-release`。健康等待失败时，恢复此前记录的版本；首次发布失败则移除本次未成功的容器。

手动回滚同样调用目标旧版本的 `activate.sh`，成功后再检查 `/api/games` 和实际游戏。镜像回滚不会恢复 `/data` 内容，修改游戏目录或 ROM 前应单独备份。

日常查看：

```sh
ssh aliyun 'docker ps --filter name=minigames-app'
ssh aliyun 'docker logs --tail=100 minigames-app'
ssh aliyun 'curl -fsS http://127.0.0.1:5178/api/health'
ssh aliyun 'cat /opt/minigames/current-release'
```

正常停止或重启此应用：`docker stop minigames-app` / `docker restart minigames-app`。不要操作其他 Compose 项目。进程退出时会停止接收请求并有界等待现有连接结束。

## 独立 ROM 管理

当前测试文件在 `/opt/minigames/data/roms/chise-yaosai.nes`，131,088 字节。上传后验证与用户 Downloads 中的原始文件一致，本机原始文件没有修改。

```text
98ed6d10391cccef249ce45cd935eb6263163f727fbf2fc11adb8116aa49f31d
```

宿主机的 `/opt/minigames/data/games.json`：

```json
[
  {"id":"nes-chise-yaosai","title":"赤色要塞","path":"/data/roms/chise-yaosai.nes"}
]
```

`path` 必须使用容器中的 `/data/...` 路径。添加游戏时，先将 ROM 上传到宿主机 `data/roms/`，设为容器可读的 `0644`，检查文件头与摘要，再备份并更新 `games.json`；建议写临时文件后原子重命名。目录在每次请求时读取，刷新即可生效，无需重建镜像。

每个 ID 唯一、只允许小写字母/数字/连字符，最多 64 字符；最多 100 个条目，单 ROM 最大 16 MiB。更换 ROM 后摘要改变，旧版本请求返回 409。原存档按 ROM 摘要和核心版本隔离，不会错误加载到新 ROM。

所有已登记游戏对能访问网站的人开放读取。服务不提供任意路径下载和远程写文件接口；生产模式对 `/src/`、`/server/`、`/.env`、`/@vite/client`、`/data/` 返回 404。

## HTTPS 与微信接入

DNS 需要一条已启用、默认线路的 A 记录：`minigames` → `120.55.88.226`。不要为没有配置 IPv6 的服务器添加 AAAA 记录。当前 DNS TTL 为 600 秒，缓存更新不保证同时完成。

首次上线曾出现国内可解析、海外 `NXDOMAIN` 的差异，导致证书签发失败。用户确认已新增默认线路记录后，保持 Caddy 自动重试，19:21:59 成功签发，没有关闭证书校验或使用自签证书。HTTP 请求现返回 308 并跳转到 HTTPS。

排查时既要查国内 DNS，也要查海外查询结果。仅服务器的 `getent` 返回 IP 不能证明证书机构已能解析。可执行：

```sh
dig @223.5.5.5 minigames.19ba.cn A
dig @1.1.1.1 minigames.19ba.cn A
dig @dns13.hichina.com minigames.19ba.cn A +subnet=8.8.8.0/24
```

第三项直接向权威 DNS 查询海外来源的记录；若仍返回 `NXDOMAIN`，需检查公网权威解析中的记录名称、默认线路、启用状态和同步情况。阿里云说明见 [添加解析记录与生效检查](https://help.aliyun.com/zh/dns/pubz-add-parsing-record)。DNS 修复后，Caddy 会继续自动重试；也可仅执行一次 `ssh aliyun 'systemctl reload caddy'` 触发重新加载，然后检查 HTTPS 和该域名的 Caddy 日志，不必重建应用。

`deploy/Caddyfile` 是单站点片段，已追加到既有 `/etc/caddy/Caddyfile`。新增前的完整备份保存在 `/opt/minigames/backups/Caddyfile-before-20260915-105326`。变更先通过 `caddy validate`，然后 `systemctl reload caddy` 平滑生效。后续不要用仓库片段直接覆盖整份服务器配置。

Caddy 自动申请和续期证书并将 HTTP 跳转到 HTTPS；依赖公网 DNS 正确和 80/443 可达。工作方式见 [Caddy 自动 HTTPS 文档](https://caddyserver.com/docs/automatic-https)。

微信小程序配置已切到此 HTTPS 域名。微信公众平台仍需要完成：

1. 在服务器域名中添加 request 合法域名 `https://minigames.19ba.cn`。
2. 在业务域名中添加 `minigames.19ba.cn`，供 `web-view` 播放器使用。
3. 将平台生成的 `MP_verify_*.txt` 放到宿主机 `/opt/minigames/data/verification/`，权限 `0644`；随后应能直接从域名根路径访问。无需重建容器。
4. 重新编译小程序，并在启用合法域名校验的条件下完成微信 iOS/Android 真机测试。

当前 ROM 在 H5 内同源下载，原生页面仅使用 request 与 web-view；尚未增加原生 `wx.downloadFile`。微信后台设置、业务域名资格及真机测试未由本次服务器部署代为完成。

## 验收与存档迁移

### 2026-09-18 iOS 触控修复（20260918-120949）

游戏操作区统一防误缩放，菜单等按钮禁止原生文字选择和长按浮层；单机、联机复用相同处理，菜单滚动、音量和房间号编辑保留。实现及测试范围见[手机界面记录](mobile-ui-implementation.md)。

通过正式 HTTPS 域名运行 `PLAYWRIGHT_BASE_URL=https://minigames.19ba.cn pnpm test:touch`：Chrome/WebKit 共 5 项通过、1 项跳过，包括连续 12 次 A 键的按下/释放、保持缩放为 1、多指移动、菜单长按、音量与房间号操作。WebKit 的多指 CDP 注入项跳过，该项只在 Chrome 执行；没有将桌面 WebKit 移动视口测试视为 iOS 微信真机验收。

同版本线上双人＋观战回归通过（26.6 秒），覆盖按键、暂停恢复、房主与来宾重连、状态一致性和房主退出。

容器健康且公网 `/api/health` 返回 `20260918-120949`。旧网页需要退出后重新进入，才能加载此次带新文件指纹的脚本与样式；此项 H5 修复不要求用户清除存档或重新安装小程序。

### 2026-09-18 联机版本

已通过正式域名 `https://minigames.19ba.cn` 进行浏览器实测，HTTPS 证书校验保持开启：

- 双人＋观战（24.7 秒）：三端实际运行原始 ROM；暂停后的完整状态一致，房主与来宾分别断线后恢复原席位，房主退出结束对局。测试禁止创建音视频串流。
- 延迟与抖动（21.1 秒）：在公网 WSS 上额外加入双向各 40–80ms 的有序延迟，至少执行 240 帧后两端完整状态相同。
- 单机回归（30.8 秒）：实际运行超过 1,200 帧、输入与声音、暂停、存档导出与一致恢复、页面重进后的存档持久化、390px 手机布局及资源边界全部通过。验收脚本在视口切换后等待下一帧布局完成，再检查宽度。
- 容器为 `minigames:20260918-111911`，健康检查通过；实际运行依赖 `ws@8.21.3`，核心 46 个文件摘要校验通过。

对应命令为 `PLAYWRIGHT_BASE_URL=https://minigames.19ba.cn pnpm exec playwright test tests/browser/netplay.spec.ts`。线上截图：[房间面板](screenshots/deployed-netplay-room.png)、[联机画面](screenshots/deployed-netplay-game.png)。

上述是桌面 Chrome 的多个隔离上下文连接真实服务，不代替 iOS 微信多机、真实三人 ROM 和蜂窝网络验收。微信开发者工具重新编译后可看到新增原生联机入口；本次没有代替用户提交小程序审核或发布小程序版本。

### 单机回归与历史记录

本地生产构建集成测试覆盖静态资源、ETag/HEAD、API、ROM 原始摘要、资源与路径边界、微信验证文件。在线回归命令：

```sh
pnpm test:deployed
```

默认检查正式 HTTPS 域名，可通过 `DEPLOYMENT_URL` 指定已授权的测试服务。测试使用独立 Chrome 存储，覆盖真实核心运行超过 1,200 帧、方向与 A 键组合、暂停、音频上下文、快存导出、摘要一致的恢复、重新进入页面后的持久化及 390px 布局。公网 HTTPS 测试不会忽略证书错误。

2026-09-15 19:23（北京时间），首次部署的正式域名 `https://minigames.19ba.cn` 的完整 Chrome 回归通过，用例约 31.3 秒：原始 ROM 摘要一致、核心进入实际关卡并运行超过 1,200 帧、音频上下文正常、方向与 A 键组合可用、暂停停止帧推进、存档导出和恢复摘要一致、重新进入后仍能读取存档、390px 布局无横向溢出。未产生页面脚本异常，游戏资源请求全部同源，开发源码与数据目录均返回 404。Google 公共 DNS 也已返回 `120.55.88.226`。

截图见 [线上游戏库](screenshots/deployed-library.png)、[线上实际关卡与快存](screenshots/deployed-player-mobile.png)。此前通过 SSH 隧道的补充测试曾遇到一次返回首页导航超时，服务健康接口正常；随后隧道原流程复测与最终公网 HTTPS 回归均通过，暂未复现。微信真机验收仍待完成。

存档仍保存在用户设备的 IndexedDB。`127.0.0.1`、正式域名、不同浏览器和微信的存储相互隔离。从本地版本迁移时，在旧地址导出 JSON 存档，再到新地址的同一游戏中导入。服务器更新不负责迁移或同步这些存档。
