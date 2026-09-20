# 开发与发布准备

**简体中文** | [English](development.en.md)

当前插件版本为 `0.2.3`，开发基线是 DSH `0.1.5-rc.1`、Cordis `4.0.2`、pi-ai `0.85.1`。产品版本不决定插件版本；npm 发布状态以 registry 为准。源码位于 EduWork 的 `packages/dsh-oidc`。

## 从干净 checkout 验证

使用 Node.js 22 或 24，在 `EduWork/packages/dsh-oidc` 执行：

```sh
npm ci
npm run check
```

`package.json` 为所需 DSH 测试闭包声明精确 devDependency；`package-lock.json` 记录 npm registry URL 和 integrity。上游预发布包的 caret 可能选择下一条 RC，因此只固定直接 peer 不够。`check:lock` 同时拒绝混装、机器路径和缺失完整性信息，`check:dsh` 校验实际加载版本。不要用运行中桌面安装目录或 junction 来替代干净安装结果，也不要使用 `--force` 或 `--legacy-peer-deps` 掩盖版本冲突。

此依赖闭包仅供本插件开发/CI；它不是整个桌面产品。发布给使用方的插件仍通过 peerDependencies 复用宿主能力。历史已验收组合见[兼容性矩阵](compatibility.md)，历史 peer 声明不代表每次提交都重测全部旧版。

完整检查包含 TypeScript、依赖锁/官方接口、Host/Client 构建、编译产物加载、Node 测试、Schema/示例、文档链接、敏感信息/许可证扫描和 npm pack 内容检查。可选 `npm run check:browser` 使用 Playwright Core 与本机 Edge/Chrome；设置 `DSH_OIDC_BROWSER_CHANNEL` 可选择已安装的浏览器渠道（默认 `msedge`）。它不下载浏览器，也不代替发行客户端的实际登录验收。

## 代码入口

| 路径 | 职责 |
| --- | --- |
| `src/host/profile.js` | 可信 Profile、受限品牌/模型配置、统一凭据引用 |
| `src/host/oidc.js` | PKCE、Token/UserInfo、身份会话与凭据写入 |
| `src/host/desktop-oidc.js` | 两种桌面外壳共用的临时 loopback 登录 |
| `src/host/resources.js` | 模型目录的保守归一化 |
| `src/host/provider/` | 官方 PiAi Provider 和显式图像转换边界 |
| `src/host/index.js`、`typert.*.js` | Host 服务、官方生命周期与公开 RPC |
| `src/client/` | 官方设置插槽、登录/账号展示、有限品牌覆盖 |
| `test/` | 合成 IdP/网关、HTTP、Host、迁移与竞态回归 |
| `schema/`、`protocol/` | Profile Schema 与当前资源 HTTP 契约 |

Host ESM 由 `scripts/build-host.mjs` 复制至 `lib`，Client 由 tsdown 打包；不要手改 `lib`。新增网络字段时应同步实现、Schema/OpenAPI、中英文规范与合约测试。UI/文档调整不需要添加机械重复实现的测试。

思考内容的字段兼容与回归入口见[思考内容回传兼容](reasoning-replay.md)。该说明区分源码修复与已安装插件包，避免沿用旧 npm 锁时误判为修复已交付。

## 扩展与发布

公共包只拥有身份、Token 授权、模型目录/调用及对应账号 UI。配额、心跳、校内检索和语音业务由机构/产品插件负责；[账户扩展](account-extensions.md)是 Host 运输与插槽边界，不是暗中启用机构功能的开关。所有示例均使用占位域名、Public Client ID 与无秘密配置。

模块通过 EduWork 的统一工作流检查和发布，参见[包维护说明](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES.md)。依赖锁、合成测试与实际部署登录分别验证；发布包使用新版本，不覆盖已有 npm 版本。
