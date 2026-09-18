# 手机界面优化：实现与本地验收

日期：2026-09-18。范围：用户确认的手机界面优化（规划 A）。本地实现完成，并随版本 `20260918-111911` 发布到 `minigames.19ba.cn`，用户已进行 iOS 微信试用；根据反馈修复后的表现待复测。随后确认开发的输入帧同步联机也已上线，见[联机实现记录](input-sync-netplay-implementation.md)。

## iOS 连点缩放与菜单选中修复

该修复已随 `20260918-120949` 部署。用户在 iOS 真机上反馈：按键容易触发页面放大，菜单按钮容易被选中。此前只有方向盘和部分手柄按钮设置禁止缩放及选中，菜单按钮和手柄之间的空白区域没有完整覆盖。

修复将 `touch-action: none` 应用于整个游戏操作区，并对该区域及播放器按钮设置 WebKit 的禁止选中、长按浮层和原生拖动样式。新增 `src/player-gestures.ts`：保留 Pointer Events 驱动的按键输入，同时取消手柄上的原生 touch 默认行为和游戏区的 WebKit 手势；菜单按钮拦截选中与上下文菜单。单机和联机共同使用这套处理。

拦截范围不包含滚动菜单、音量滑块和房间号输入框，仍可滚动、编辑和复制文字。没有全局关闭 viewport 缩放或移除键盘焦点标识。依据：[WebKit 触控行为说明](https://webkit.org/blog/5610/more-responsive-tapping-on-ios/)与[Apple CSS 属性参考](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariCSSRef/Articles/StandardCSSProperties.html)。

本地验证：原有 4 项手机布局、输入及存档浏览器测试通过；新增 Chrome 的真实连点、多指移动、长按、菜单操作检查通过。跨浏览器触控套件共 5 项通过、1 项跳过：WebKit 通过连点与手势/选中边界检查，CDP 多指注入只在 Chrome 执行，未把它计作 WebKit 多指验收。实际按键按下/释放仍进入真实核心，连点后缩放为 1，方向+A 释放后无卡键，音量和输入框保持可用。

复现：先执行 `PLAYWRIGHT_BROWSERS_PATH=.runtime/playwright pnpm exec playwright install webkit`，然后运行 `pnpm test:touch`。这些是桌面 Chrome/WebKit 的移动视口测试，修复后的 iOS 微信真机表现仍需用户复测。发布状态见[部署记录](deployment.md)。

以下章节保留最初界面改版的实现和验收记录。

## 已实现

- 横屏为左手柄／中央画面／右手柄；竖屏为大画面与下方手柄。画面始终按 4:3 放入实际可用区域，不拉伸、不裁切。
- 移除厚屏幕边框、装饰条和常驻存档栏。`source=wechat` 的小程序入口收起重复 H5 标题栏，保留微信自身导航行为；普通浏览器仍有返回入口和游戏名。
- 标准方向盘 144px，大号 156px；A/B 标准 64px、大号 72px。窄屏会按可用空间收紧尺寸，避免按键重叠。SELECT/START 和菜单按钮触控高度至少 44px。
- 方向盘支持连续滑动和八方向，小中心死区；方向+A、方向+B、方向+A+B 可同时保持。输入按来源合并，放开触屏按键不会取消键盘上仍按住的同一键。
- 按键抬起、触控取消、丢失捕获、旋转/尺寸变化、打开菜单、失焦和离开页面会释放输入。旋转不重新创建模拟器或加载 ROM。
- 菜单含继续、快存/读快存、三个手动存档槽、导出/导入、音量与静音、按键大小、左右布局、重开与返回。菜单内部可滚动，继续按钮固定在菜单顶部。
- 打开菜单暂停并保留核心截图；保存、读档完成后仍停留在菜单，由用户明确继续。页面失焦或切后台同样暂停，后台完成的异步操作不会自动恢复游戏。
- 大小、布局、音量、静音存入当前站点 localStorage；存储不可用时本次会话仍可设置。游戏存档数据库、格式、ROM 摘要与模拟器核心保持原样。
- 小程序播放器页增加 `pageOrientation: auto`、`disableScroll: true`，已通过 TypeScript 构建。

## 文件

| 文件 | 改动 |
| --- | --- |
| `player.html` / `src/player.css` | 游戏区域、响应式手柄、暂停菜单与触控尺寸 |
| `src/player.ts` | 菜单/生命周期状态、偏好与声音、现有存档交互接入 |
| `src/gamepad.ts` | 八方向计算、多输入源合并、触控/键盘与释放 |
| `src/player-layout.ts` | visualViewport、resize、安全区后的空间计算与偏好读写 |
| `miniprogram/pages/player/index.json` | 自动横竖屏与禁用原生外层滚动 |
| `tests/gamepad.test.ts` / `tests/browser/player.spec.ts` | 输入边界、真 ROM 手机布局与存档回归 |
| `tests/deployed/smoke.spec.ts` | 更新菜单中的继续操作，供后续发布验收 |

## 已执行检查

- `pnpm build`：通过，包含前端、生产服务、小程序编译。
- `TEST_ROM_PATH='/Users/zebo/Downloads/nes/赤色要塞.nes' pnpm test`：9 项通过，原始 ROM 摘要一致。
- `pnpm exec playwright test tests/browser/player.spec.ts`：4 项通过。真实固定核心运行、音频、暂停冻结帧、快存/手动存档、导出/导入、哈希一致的恢复、重新进入持久化均通过。
- 真触控事件覆盖滑动转向、斜向+A+B、触控取消，以及触控和键盘同键同时按住后的部分释放；输入已发送给真实核心。旋转后确认模拟器对象未替换且帧数继续增长。
- 320×568、375×600、390×740、430×820、568×320、667×300、844×390、932×360 共 8 组 H5 视口：页面无横向或纵向溢出，画面 4:3，手柄全部在视口内。
- 大号、左右布局、35% 音量在重新加载后保留；菜单打开/继续、切后台暂停和暂停截图通过。
- `pnpm test:production`：生产构建及 1 项生产服务集成测试通过。没有对线上服务运行修改或部署命令。
- `pnpm exec playwright test tests/browser/soak.spec.ts`：30.245 秒推进 1,814 帧，约 59.98 FPS；音频上下文 running、采样峰值约 0.493，无页面脚本异常。这是本机 Chrome 数据，不代表 iPhone 帧率或温度表现。

30 秒检查的运行断言通过后，Playwright 工作进程在退出阶段停留；本次仅定向清理该测试工作进程，运行器随后汇总 `1 passed`、退出码 0。其余 4 项浏览器回归正常退出。未据此修改播放器或模拟器逻辑。

以上浏览器测试使用本机 Chrome 与独立存储，不等于 iOS 微信真机测试。

## 截图

- [竖屏](screenshots/mobile-v2-portrait.png)
- [横屏，方向盘在右](screenshots/mobile-v2-landscape.png)
- [暂停菜单](screenshots/mobile-v2-menu.png)

截图来自真实 ROM。不同手机中 H5 可用高度、微信导航与安全区占用不同，控件会随实际空间调整。

## 预览与待验收

本地预览：`http://127.0.0.1:5173/player.html?game=nes-chise-yaosai`。浏览器模拟小程序内布局可增加 `&source=wechat`；这个参数只收起 H5 标题栏，不代表真实微信容器。

后续发布 H5 并重新编译小程序后，在 iOS 微信里核实：

1. 横竖屏原生容器随手机旋转，Home 指示条、刘海和导航不遮挡按键。
2. 真手指斜向、滑动转向和方向+A+B 没有误滚动、放大或卡键。
3. 打开菜单、系统文件选择、分享返回、锁屏和电话打断后保持暂停，点击继续恢复声音。
4. 旧存档能读取，旋转时暂停截图不黑屏，持续游玩至少 20 分钟无异常。

本地修改不会自动更新服务器上的 H5；服务器发布和小程序更新是后续验收所需的两个步骤。
