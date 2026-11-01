# 第三方声明

`@eduwork/dsh-remote-access` 的原创贡献使用木兰 PSL v2，历史 MIT 授权保留，详见[许可范围](LICENSING.md)。发布产物打包了下列软件包的代码；构建脚本从实际打包的依赖收集各包的许可证全文，随包放在 `lib/THIRD_PARTY_LICENSES.txt`。精确版本见 `package-lock.json`。

- 宿主插件与网页客户端的加密：`noise-handshake`、`b4a`（Apache-2.0），`sodium-javascript`、`sodium-universal`、`blake2b-wasm`、`siphash24`、`xsalsa20`（MIT），`blake2b`、`chacha20-universal`、`nanoassert`、`sha256-universal`、`sha256-wasm`、`sha512-universal`、`sha512-wasm`（ISC）。
- 中继服务：`ws`（MIT）。
- 设置页：`zod`、`uqr`（MIT）。

DeepSeek Harness 软件包、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` 和 React 由宿主提供，作为 peer dependency 出现，不打包进本包，也不表示其作者认可本项目。网页图标取自 EduWork 自有 Logo，按本项目[许可范围](LICENSING.md)中的代码/素材声明使用；代码许可不授予商标权。
