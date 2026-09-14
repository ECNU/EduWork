# 第三方声明

**简体中文** | [English](THIRD_PARTY_NOTICES.en.md)

`dsh-oidc` 使用 MIT 许可证，并与以下直接声明的软件包互操作。精确版本记录在 `package-lock.json` 中；间接依赖的许可证文件保留在各自发布包内。

## 运行时 Peer（源码未复制进本仓库）

- DeepSeek Harness `0.1.5-rc.1` 软件包和 `@deepseek-ai/cordis` `4.0.2`——MIT，Copyright (c) 2026 DeepSeek，<https://github.com/deepseek-ai/deepseek-harness>
- `@earendil-works/pi-ai` `0.85.1`——MIT，<https://github.com/earendil-works/pi>
- React `18.x`——MIT，Copyright (c) Facebook, Inc. and its affiliates，<https://github.com/facebook/react>

本仓库使用这些软件包的公开 API，不 vendor 其源码。它们作为 peer dependency 出现，不表示其作者认可本项目。

## 浏览器产物中包含的代码

生成的 `lib/client.js` 打包了 Zod：

### Zod 4.4.3

以下许可证正文保持英文原文：

MIT License

Copyright (c) 2025 Colin McDonnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

源码：<https://github.com/colinhacks/zod>

## 仅开发使用的工具

锁文件固定 RC.1 DSH 测试闭包及 tsdown（MIT）、TypeScript/Playwright Core（Apache-2.0）、Ajv（MIT）、YAML（ISC）、React 类型（MIT）。开发工具不复制到发布的运行文件。Playwright Core 安装时不下载浏览器二进制。

当前锁标记两个生命周期脚本：`@google/genai@1.52.0` 只有 echo 的 preinstall；`protobufjs@7.6.6` 读取本地 package manifest，必要时输出版本约定提醒，所审查 postinstall 没有下载和进程执行。此次本机 npm allow-scripts 策略仍未批准这两项；锁变化后应重新审查。安装成功不代表已完成安全审计。

`fast-sha256@1.3.0` 经 pi-ai → Anthropic SDK → standardwebhooks 引入，声明 Unlicense。已核对其分发 LICENSE 中复制、修改、分发授权与免责条款；许可证检查只为该包的该版本记录例外，不放开其他未知许可证。其源码不复制进本仓库。

当前已审查锁共有 260 个声明许可证的软件包条目：0BSD (1), Apache-2.0 (46), BSD-3-Clause (12), ISC (2), MIT (197), Python-2.0 (1), Unlicense (1)。正式发布锁应重新生成清单。
