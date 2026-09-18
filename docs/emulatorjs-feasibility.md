**EmulatorJS 可行性补充（待确认）**

当前状态：用户已确认 ROM 方向并提供本地 NES 测试文件。根据这些信息形成的开发规划、接口规范和样本检查见 [ROM 文档索引](/Users/zebo/Documents/game-monitor/docs/README.md)。本文保留作为可行性调研依据。

调研日期：2026-09-15。本轮检查了 EmulatorJS 官方文档、加载器源码、许可证，以及微信运行环境文档；未安装、运行或进行手机测试。

**可以把 EmulatorJS 作为「模拟器 + 独立 ROM」路线的候选，但原版不能直接当作微信小游戏组件使用。** 如果目标是 FC/NES、Game Boy、GBA 等游戏 ROM，它比逐个开发 Cocos 游戏更贴近“游戏文件单独加载”的描述；如果目标是任意 H5 游戏包或自研现代小游戏，EmulatorJS 不提供对应的通用执行能力。[支持的系统](https://emulatorjs.org/docs/systems/)。

EmulatorJS 是浏览器中的 RetroArch 前端，使用 WebAssembly 模拟器核心。应用选择模拟系统和 ROM 地址；官方配置项 `EJS_core` 指定系统或核心，`EJS_gameUrl` 指向 ROM，部分系统另需 `EJS_biosUrl`。游戏文件与模拟器程序可以独立托管。[项目介绍](https://emulatorjs.org/docs/)、[接入示例](https://emulatorjs.org/docs/getting-started/)。

| 接入路线 | 可行性判断 | 需要的工作 |
| --- | --- | --- |
| 独立 H5 网页 + EmulatorJS | 属于项目原生用途，可作为第一步技术验证 | 托管固定版本程序和核心，配置 ROM，开发目录、存档和后台 |
| 微信内置浏览器打开 H5 | 候选方案，未做微信真机验证 | 检查 WASM、图形、音频、触控、缓存和生命周期 |
| 普通小程序 web-view 打开 H5 | 技术上具备网页承载路径，实际兼容和产品准入未确认 | 具备 web-view 权限、配置业务域名，并核实游戏内容和主体类目要求 |
| 微信小游戏原生运行原版 EmulatorJS | 无法直接接入 | 需要移植加载机制、界面、核心依赖和平台接口，不是增加一个 npm 包即可完成 |
| 微信小游戏运行定制模拟器核心 | 可专项验证，当前未证实 | 先选一个核心，检查编译产物、WASM 能力、音频与文件适配及正式代码包约束 |

原版加载器通过 `document.createElement` 插入脚本与 CSS，依赖真实网页环境。微信小游戏不提供浏览器 DOM；官方 Adapter 只是局部模拟，不保证浏览器库无缝运行。这是“不能直接接入”的源码和平台依据。[EmulatorJS 加载器](https://github.com/EmulatorJS/EmulatorJS/blob/main/data/loader.js)、[微信 Adapter 文档](https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html)。

若选择原生路线，更合理的研究对象是“选定模拟器核心 + 微信专用界面与适配层”，不预设能够完整保留 EmulatorJS 的网页 UI。核心使用的 JS 胶水代码、WASM 功能、线程、文件系统和图形接口都要逐项实测，不能将微信支持部分 WebAssembly 能力等同于兼容所有 Emscripten 构建产物。核心和加载代码的发布仍受微信代码机制约束。

**H5 候选架构为：游戏目录 → EmulatorJS 播放页面 → 固定版本模拟器核心 + 独立 ROM；播放页面直接连接业务后端保存进度。** 管理后台维护 ROM 目录和版本，资源存放在对象存储/CDN。小程序 web-view 只是在准入允许时增加的入口，不是浏览器方案成功后自动成立的发布渠道。

| 事项 | 建议设计 |
| --- | --- |
| 核心范围 | 首先验证 NES/FC 单系统；通过后再加入 GB/GBA，不承诺所有支持列表中的系统都有可用手机性能 |
| 游戏清单 | 保存 `gameId`、系统、核心与版本、ROM URL、ROM 摘要、大小、可选 BIOS 摘要和授权记录 |
| 版本分离 | 分别锁定 EmulatorJS 版本、核心版本和 ROM 摘要；正式部署不跟随会自动变化的 latest 链接 |
| 下载 | 模拟器和核心自托管，配置正确文件类型及跨域策略；明确区分 ROM 下载失败与核心初始化失败 |
| 存档 | 区分游戏内存档与模拟器即时状态；绑定用户、ROM 摘要、核心版本，不默认跨核心版本兼容 |
| 云同步 | 优先通过公开存档接口接入后端；采用周期性或用户主动保存，不能只依赖页面退出事件 |
| 移动操作 | 屏幕虚拟按键、触摸多键、音频激活、暂停恢复和安全区域适配 |
| 本地导入 | 网页有 ROM 选择/加载路径，但微信内文件选择体验需要单独测试；不承诺能任意读取手机文件 |

EmulatorJS 提供保存/读取状态等功能。业务集成应使用公开配置与事件，避免依赖易变的内部 API。[功能列表](https://emulatorjs.org/docs/features/)、[配置与事件](https://emulatorjs.org/docs/options/)。

**多线程不是所有 EmulatorJS 游戏的必需条件。** 官方 `EJS_threads` 默认关闭；启用线程需要 `SharedArrayBuffer` 以及满足 COOP/COEP 等跨源隔离要求。首个验证版本应选择支持单线程的核心，不依赖线程；如果需要多线程，要检查微信实际内核和嵌入环境，设置响应头本身不能保证能力可用。[线程配置](https://emulatorjs.org/docs/options/)。

web-view 网页向小程序发送的消息不是实时交付通道，不能依赖它持续推送游戏进度；云存档由 H5 直接请求后端。若采用小程序登录态引导 H5 登录，建议使用短期、单次兑换票据建立限权会话，不在 URL 中放长期账号凭据。[微信 web-view 文档](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)。

**独立 ROM 加载不等于新增游戏免审。** ROM 本身包含游戏程序和内容，不能因为它是模拟器输入，就把它等同于图片或音频资源，进而推导可以在微信内无限增加未审核游戏。普通小程序与小游戏的类目、审核及实际内容一致性仍需核实。目前没有足够的平台依据确认“通用模拟器 + 动态 ROM 游戏库”能够按该形态正式上线。[微信运营规范](https://developers.weixin.qq.com/miniprogram/product/)。

EmulatorJS 项目采用 GPL-3.0-or-later；具体模拟器核心还需按各自许可证评估。软件许可证不替代游戏 ROM 和 BIOS 的使用、分发授权。测试应使用自制或明确获得相应授权的内容，不在方案中默认取得商业游戏素材的权利。[EmulatorJS LICENSE](https://github.com/EmulatorJS/EmulatorJS/blob/main/LICENSE)。

建议确认后的验证顺序：

1. 选一个 NES 核心和一份自制或授权 ROM，锁定 EmulatorJS 与核心版本。
2. 在标准浏览器验证远程 ROM 加载、虚拟按键、声音和保存恢复。
3. 在 Android/iOS 微信内置浏览器验证；若具备小程序 web-view 条件，再单独测试该环境。
4. 记录首次加载、稳定帧率、音频延迟、切后台恢复、缓存清除、游戏切换与存档恢复结果。
5. 结合实际主体、游戏内容与平台准入结果，决定 H5、小程序 web-view 或原生核心移植路线，再估算实施工作量。

此前 Cocos 方案的工期仅适用于自研小游戏模块，不适用于 EmulatorJS 原生移植。当前仅补充候选路线，没有变更为已确认的实施方案，也没有开始开发。
