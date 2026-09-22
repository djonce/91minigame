# 第三方运行组件

本项目的本地安装脚本从官方来源下载运行依赖，没有将 ROM 放入程序包。

| 组件 | 固定来源 | 许可说明 |
| --- | --- | --- |
| EmulatorJS 4.2.3 | https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3 | GPL-3.0-or-later，原 LICENSE 保留于 `.runtime/emulatorjs/4.2.3/LICENSE`，源码在 `.runtime/upstream/` |
| FCEUmm core / RetroArch WASM 构建 | https://cdn.emulatorjs.org/4.2.3/data/cores/fceumm-legacy-wasm.data | 核心产物内含许可数据；FCEUmm 与 RetroArch 有各自 GPL 许可，分发时需按对应源码和许可履行义务 |
| Node 开发依赖 | `package.json`、`pnpm-lock.yaml` | 依赖包内保留各自 LICENSE |
| ws 8.21.3 | https://github.com/websockets/ws/tree/8.21.3 | MIT，运行依赖包内保留 LICENSE |
| JSNES 2.1.0 | https://www.npmjs.com/package/jsnes/v/2.1.0 / https://github.com/bfirsh/jsnes | Apache-2.0，原生验证页使用；许可随包保存在 `miniprogram/native/vendor/JSNES-LICENSE.txt` |
| @noble/hashes 1.8.0 | https://github.com/paulmillr/noble-hashes/tree/1.8.0 | MIT，原生 ROM SHA-256 校验；许可随包保存在 `miniprogram/native/vendor/HASHES-LICENSE.txt` |

原生页使用 `scripts/native-core-entry.ts` 和 `scripts/build-native-core.mjs` 从固定 npm 依赖打包。2026-09-20 起，构建时通过 `scripts/jsnes-sprite-patch.mjs` 修正 JSNES 2.1.0 的 8×16 精灵图块寻址与垂直翻转命中判断，修改标识为 `sprites1`；补丁校验上游源码 SHA-256，安装的原始依赖文件未修改。生成的核心文件头注明修改及源码位置。构建不包含浏览器包装器，不从服务器加载 JavaScript。JSNES 的原始源码可从上述固定版本 npm 包获取；项目中的原生适配源码在 `miniprogram/native/` 和 `miniprogram/pages/native-nes/`。

原生构建 `perf1` 保留上述图形修复，并通过 `scripts/jsnes-memory-patch.mjs` 对独立 Uint8Array 内存块使用原生批量复制。该补丁同样校验 JSNES 2.1.0 上游源码摘要，补丁源码及修改声明随项目保留。原生 GPU 适配位于 `miniprogram/native/renderer.ts`。

参考源码：[FCEUmm](https://github.com/libretro/libretro-fceumm)、[EmulatorJS RetroArch](https://github.com/EmulatorJS/RetroArch)。配置和适配变更保存在本项目源文件中，未改写下载的运行文件。联机在校验 JS glue 摘要后进行内存中的逐帧桥接，变更源码位于 `src/netplay/runtime.ts`，与下载包的原始源码及许可一并保留；单机继续使用原包装。

用户提供的 ROM 仅用于本机测试，归属与授权独立于模拟器许可。本地原型不包含公共 ROM 分发服务或正式发布授权。
