**ROM 目录、运行层与 API 规范 v1.0（设计稿）**

本规范配套 [开发计划](/Users/zebo/Documents/game-monitor/docs/rom-game-development-plan.md)。以下字段、路由和接口是拟建项目的约定，尚未实现；微信与 EmulatorJS 原生名称会单独标明。

**首期内容交付单位是一份 NES ROM 加一条清单记录。** 首期管理员上传 `.nes` 文件，不要求自行压成 ZIP；暂不接受压缩包、脚本包或任意 URL 抓取。扩展系统以 `system` 字段预留，实际运行核心使用服务端允许列表。

| 对象 | 身份与职责 |
| --- | --- |
| Game | `gameId`：稳定目录 ID，名称可修改，不携带机器文件路径 |
| ROM Asset | `romSha256`：原始完整字节摘要；保存大小、格式、导入检查结果和对象存储键 |
| ROM Payload | `payloadSha256`：格式解析后的内容摘要，用于排查文件头差异，不能替代精确存档身份 |
| Runtime Profile | `runtimeProfileId`：绑定 EmulatorJS 版本、核心构建、核心文件摘要、重要设置与存档兼容代号 |
| Game Release | 绑定 Game、ROM Asset 与 Runtime Profile；记录测试状态、发布时间、下线状态 |
| Save | 绑定用户、ROM、运行配置、状态类型和槽位，另有服务端修订号 |

测试样本的清单草案如下。`candidate`、`pending` 和 `null` 明确表示尚未完成运行产物锁定及可玩验证，不能由此记录直接生成正式发布条目。

```json
{
  "schemaVersion": 1,
  "gameId": "nes-chise-yaosai",
  "emulatorGameId": 1001,
  "title": "赤色要塞",
  "system": "nes",
  "releaseId": "nes-chise-yaosai-local-original-1",
  "visibility": "test-only",
  "rom": {
    "originalFileName": "赤色要塞.nes",
    "assetKey": null,
    "sizeBytes": 131088,
    "sha256": "98ed6d10391cccef249ce45cd935eb6263163f727fbf2fc11adb8116aa49f31d",
    "payloadSha256": "6928e8c589d6d9cc199a7b0841877531ef53dce479e36f90ec1d9cdcbf54372d",
    "headerFormat": "archaic-ines",
    "mapperRawCombined": 66,
    "mapperLegacyCandidate": 2,
    "headerWarnings": ["DISKDUDE_HEADER"],
    "compatibilityStatus": "pending"
  },
  "runtime": {
    "profileId": "nes-fceumm-ejs423-candidate",
    "emulatorVersion": "4.2.3",
    "core": "fceumm",
    "coreBuildId": null,
    "binaryManifestSha256": null,
    "threads": false,
    "biosAssetId": null,
    "status": "candidate"
  },
  "presentation": {
    "preferredOrientation": "landscape",
    "portraitFallback": true,
    "maxPlayersMvp": 1
  },
  "savePolicy": {
    "primaryKind": "state",
    "manualSlots": 3,
    "quickSlot": "quick",
    "compatibilityId": null
  }
}
```

游戏名称来自文件名，不代表已经核验游戏画面、发行区域或版本。`emulatorGameId` 是分配给 EmulatorJS 的稳定整数，不能在不同 ROM/核心不兼容版本间随意复用。正式数据库中由唯一索引保证分配不冲突，不使用有碰撞风险的简单字符串哈希。

**管理员导入状态依次为 `uploaded → inspected → verified → published`，失败为 `rejected`，发布后可进入 `disabled`。** `inspected` 只说明结构检查结束；`verified` 需要指定运行产物与实测记录；`published` 还需要适用的内容发布条件满足。存在旧式头警告的样本可进入受控测试，不因 Mapper 原始值 66 自动拒绝，也不直接标记兼容。

检查项目包含魔数、最小文件长度、格式分支、声明容量与实际长度、Trainer 标记、Mapper 解析警告、文件摘要、重复内容和运行测试。NES 2.0 使用自身长度编码与字段规则，不套用本次样本的旧式头处理逻辑。首期上传软限制为 16 MiB（项目配置，非 NES 格式上限）；本样本约 128 KiB。

文件名只用于显示，对象存储键由服务端生成；不把原始文件名作为文件系统路径。ROM 和存档原始对象默认私有，后端校验权限后发放短期访问地址。播放器读取前验证下载长度和摘要；若 EmulatorJS 的固定版本无法直接接收已校验的二进制或 Blob URL，P0 需决定最小适配方式，不能出现“校验一份文件，模拟器又加载另一份”的情况。[EmulatorJS 资源路径配置](https://emulatorjs.org/docs/options/)。

**模拟器运行时与目录条目分开版本化。** 运行产物清单要记录 loader、主 JS/CSS、FCEUmm 的 JS/WASM/配套文件及实际所需依赖的相对路径、长度和 SHA-256；目录结构以下载的发行产物为准，不凭经验硬编码漏文件的清单。产物全部上传成功并检查可访问后才激活配置。

| EmulatorJS 配置 | 首期约定 |
| --- | --- |
| `EJS_player` | 独立播放页内唯一根元素 |
| `EJS_core` | 显式选择 `fceumm`；`nestopia` 仅作受控对比，不在失败时无提示切核 |
| `EJS_gameUrl` | 当前会话匹配的 ROM 地址或 P0 验证支持的本地 Blob URL |
| `EJS_pathtodata` | 固定版本、自托管资源目录 |
| `EJS_gameID` | 由平台分配的稳定整数，版本隔离策略与存档键一致 |
| `EJS_gameName` | 稳定内部名称，展示标题由业务界面管理，避免改名破坏内部缓存/存档路径 |
| `EJS_threads` | `false`；验证候选版本是否仍允许 UI 开启线程，测试配置保持单线程 |
| `EJS_startOnLoaded` | 默认不自动启动，等待用户明确点击，以完成音频交互授权 |
| `EJS_biosUrl` | 本次普通 NES 卡带测试留空；不因文件名或旧标记误判为 FDS |

配置来源：[NES/Famicom 接入说明](https://emulatorjs.org/docs/systems/nes-famicom/)。普通 NES 卡带不以 FDS BIOS 为前置条件；FDS 与其他系统另行扩展。[FCEUmm 文档](https://docs.libretro.com/library/fceumm/)。

**RuntimeAdapter 是拟建的业务封装，不声称 EmulatorJS 原生具有下表同名接口。**

| 契约 | 含义与完成条件 |
| --- | --- |
| `prepare(session)` | 拉取运行配置与 ROM，检查版本和完整性，创建播放器；完成不等于游戏已经开始 |
| `start()` | 用户触发启动，进入可接收输入的状态；收到候选版本实际启动回调后报告 running |
| `pause(reason)` / `resume()` | 处理设置、失焦与后台恢复，释放按键，恢复必须符合音频交互要求 |
| `captureState(slot)` | 返回即时状态二进制、可选截图与兼容元数据；未完成写入不报告保存成功 |
| `restoreState(record)` | 先检查 ROM 与运行配置兼容性，再恢复；拒绝不兼容状态 |
| `setVolume(value)` | 设置 0–1 音量并本地记忆 |
| `exit()` / `destroy()` | 退出、停止音频、释放输入和实例；重复调用安全 |
| 状态事件 | `preparing`、`ready`、`running`、`paused`、`saving`、`error`、`exited` |

P0 将业务契约映射到锁定版本实际提供的公开配置、事件和原生 UI。保存状态与保存电池数据是两个不同通道；暂不预设固定版本存在可直接调用的周期即时存档方法。公开接口不足时，记录最小补丁、维护范围和回归用例，经方案更新后再扩展功能。[公开回调说明](https://emulatorjs.org/docs/options/)。

**API 均以 `/api/v1` 为前缀，返回 JSON；ROM 与存档字节单独传输。** 建议响应含 `requestId`，错误含稳定 `code`、用户可读 `message` 与 `retryable`。客户端标识只用于定位条目，用户身份以服务器会话为准。

| 方法与路由 | 输入和结果 | 权限 |
| --- | --- | --- |
| `POST /auth/wechat` | 微信登录 code 换平台会话；AppSecret 不返回客户端 | 小程序登录入口 |
| `GET /games` | 返回当前用户可见的目录，支持游标；不暴露私有文件路径 | 允许的访客或登录用户 |
| `GET /games/:gameId` | 详情、可用版本和个人最近进度摘要 | 同目录权限 |
| `POST /launch-tickets` | `gameId`、可选存档槽 → 单次票据与有效期；服务端确定 release/profile | 小程序用户会话 |
| `POST /launch-tickets/exchange` | 单次票据 → 限定当前游戏的播放会话、资源配置与存档能力 | 有效票据，一次兑换 |
| `POST /play-sessions/:id/asset-access` | 已授权资源 ID → 新短期下载地址，支持过期后重试 | 当前播放会话 |
| `POST /play-sessions/:id/end` | 结束会话并记录原因；重复请求不重复累计 | 当前播放会话 |
| `GET /games/:gameId/saves` | 返回当前用户的槽位、ROM/核心兼容信息和服务端修订号 | 用户会话或受限播放会话 |
| `POST /save-uploads` | 存档类型、槽位、字节数、摘要、兼容信息 → uploadId 与上传方式 | 绑定相同游戏的用户 |
| `POST /save-uploads/:uploadId/commit` | 文件传输完成后确认；检查摘要、所属用户、expectedRevision，返回新 revision | 创建上传的用户 |
| `GET /saves/:saveId/content` | 返回当前用户可读取存档的短期地址 | 存档所有者 |
| `POST /admin/rom-imports` | 上传单个 NES 文件与资料，返回导入任务 | 管理员 |
| `GET /admin/rom-imports/:id` | 查看解析结果、警告和验证状态 | 管理员 |
| `PATCH /admin/games/:gameId` | 修改展示资料、选择已验证版本 | 管理员 |
| `POST /admin/games/:gameId/publish` | 校验前置条件并激活已验证 release，写审计日志 | 发布权限 |
| `POST /admin/games/:gameId/disable` | 停止新会话，保留历史版本和存档 | 发布权限 |

上传可先由 API 接收 multipart，规模增加后再改成对象存储直传；客户端不信任“上传请求返回成功”就认为数据已提交，commit 必须核实目标对象。`commit` 与结束会话使用幂等键；同一幂等键不同请求体应拒绝，作用域包含用户和操作。

启动票据默认 60 秒有效，一次兑换后原子作废，绑定用户、game/release/profile。优先放在播放页 URL 的 fragment，页面读取后清除并通过 POST 兑换，避免票据进入正常 HTTP 访问日志；小程序 web-view 是否完整保留 fragment 在 P1 验证。若需 query 兼容路径，应清除地址、过滤日志并设置 `Referrer-Policy: no-referrer`。长期会话凭据不放 URL。

播放会话返回短期限权令牌，在 H5 内存中使用；API 与播放页优先同源，经反向代理降低 CORS 和 Cookie 限制。令牌过期时可保存本地进度，并重新走微信登录/启动票据流程，不能丢弃尚未同步的存档。H5 电脑原型使用独立本地开发身份，不伪造微信身份，也不把开发身份放进正式配置。

**即时存档以不可变兼容键区分，槽位以修订号管理。** 建议键为 `userId + romSha256 + saveCompatibilityId + kind + slot`；`saveCompatibilityId` 对应实际核心构建与关键设置。全文件 SHA 不同或核心兼容代号不同，默认拒绝直接覆盖和恢复。旧文件头派生副本即使有效载荷相同，也不能自动宣称即时状态兼容。

| 存档规则 | 约定 |
| --- | --- |
| 类型 | `state` 为模拟器即时状态；`sram` 为游戏电池存档，两个类型分开 |
| 槽位 | `quick`、`manual-1`、`manual-2`、`manual-3`，按用户和兼容键隔离 |
| 大小 | NES 即时状态上传暂设 8 MiB 可配置上限；这是工程限制，P0 测量后调整 |
| 本地优先 | 写入状态与元数据成功后显示“已保存到本机”；上传成功后显示“已同步” |
| 云冲突 | 提交包含 expectedRevision；不匹配返回 409，保留本地副本供用户选择 |
| 原子提交 | 二进制核验成功后在数据库事务内切换槽位指针；保留最近一个可回退修订 |
| 恢复 | 先校验内容摘要与兼容键，无法恢复时保留原存档并给出原因 |
| 数据最小化 | ROM 内容、存档二进制和凭据不写进运行日志 |

错误码初稿为 `ROM_INVALID`、`ROM_HEADER_WARNING`、`ROM_INCOMPATIBLE`、`ASSET_DOWNLOAD_FAILED`、`ASSET_HASH_MISMATCH`、`CORE_INIT_FAILED`、`STORAGE_FULL`、`SAVE_INCOMPATIBLE`、`SAVE_CONFLICT`、`SESSION_EXPIRED`、`GAME_DISABLED`。文件头警告本身不是运行失败；诊断界面要展示已经尝试的核心和原始/派生文件状态。

**数据模型按单体服务实施。** `users`、`games`、`rom_assets`、`runtime_profiles`、`game_releases`、`launch_tickets`、`play_sessions`、`save_revisions`、`save_slots`、`audit_logs`。ROM 与运行配置不可变；目录指针可切换；存档 revision 只新增，槽位指针在事务内更新。`launch_tickets` 只保存票据哈希，限制重放和兑换竞态。

正式发布前核实 EmulatorJS、实际核心与对应发行产物的许可证和所需源代码提供方式；测试 ROM 的本地使用不被解释为自动获得公开分发权。当前只规划私有测试接入，不预先建立公开 ROM 下载站。[EmulatorJS LICENSE](https://github.com/EmulatorJS/EmulatorJS/blob/main/LICENSE)、[FCEUmm 许可信息](https://docs.libretro.com/library/fceumm/)。
