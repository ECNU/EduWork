# 第三方声明

`@eduwork/dsh-remote-access` 使用 MIT 许可证。发布产物打包了下列软件包的代码；构建脚本从实际打包的依赖收集各包的许可证全文，随包放在 `lib/THIRD_PARTY_LICENSES.txt`。精确版本见 `package-lock.json`。

- 宿主插件与网页客户端的加密：`noise-handshake`、`b4a`（Apache-2.0），`sodium-javascript`、`sodium-universal`、`blake2b-wasm`、`siphash24`、`xsalsa20`（MIT），`blake2b`、`chacha20-universal`、`nanoassert`、`sha256-universal`、`sha256-wasm`、`sha512-universal`、`sha512-wasm`（ISC）。
- 中继服务：`ws`（MIT）。
- 设置页：`zod`、`uqr`（MIT）。

DeepSeek Harness 软件包、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` 和 React 由宿主提供，作为 peer dependency 出现，不打包进本包，也不表示其作者认可本项目。网页图标取自 EduWork 自有 Logo，随本项目 MIT 许可提供。
