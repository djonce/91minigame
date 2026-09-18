# 第三方运行组件

本项目的本地安装脚本从官方来源下载运行依赖，没有将 ROM 放入程序包。

| 组件 | 固定来源 | 许可说明 |
| --- | --- | --- |
| EmulatorJS 4.2.3 | https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3 | GPL-3.0-or-later，原 LICENSE 保留于 `.runtime/emulatorjs/4.2.3/LICENSE`，源码在 `.runtime/upstream/` |
| FCEUmm core / RetroArch WASM 构建 | https://cdn.emulatorjs.org/4.2.3/data/cores/fceumm-legacy-wasm.data | 核心产物内含许可数据；FCEUmm 与 RetroArch 有各自 GPL 许可，分发时需按对应源码和许可履行义务 |
| Node 开发依赖 | `package.json`、`pnpm-lock.yaml` | 依赖包内保留各自 LICENSE |

参考源码：[FCEUmm](https://github.com/libretro/libretro-fceumm)、[EmulatorJS RetroArch](https://github.com/EmulatorJS/RetroArch)。配置和适配变更保存在本项目源文件中，未改写下载的运行文件。

用户提供的 ROM 仅用于本机测试，归属与授权独立于模拟器许可。本地原型不包含公共 ROM 分发服务或正式发布授权。
