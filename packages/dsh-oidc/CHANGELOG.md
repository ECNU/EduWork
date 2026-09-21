# 变更日志

**简体中文** | [English](CHANGELOG.en.md)

所有重要变更均记录于此。格式遵循 Keep a Changelog 原则；项目使用语义化版本，并遵循[兼容性与发布策略](docs/compatibility.md)中对 1.0 之前版本的说明。

## [0.3.0-dev.2] - 2026-09-21

- 使用 `allowInsecureDevelopment` 单一开关显式允许 HTTP 测试服务，默认关闭；HTTPS 行为不变。
- 兼容读取旧 `insecureDevelopmentOrigin` 字段，但不再要求重复配置地址。
- 统一 OIDC、OIDC-LLM、LiteLLM 与模型请求的传输策略，并补齐配置示例和回归测试。

## [0.2.0] - 2026-09-11

- 适配 DSH 0.1.5-rc.1，企业身份、托管 Key 和模型接入独立于机构专属服务。
- 新增桌面 OIDC 临时 loopback 回调与宿主浏览器接入。
- 默认凭据引用统一为 `EDUWORK_API_KEY`，匹配的旧绑定可迁移，不覆盖已有目标槽位。
- 提供账户扩展运输接口与 UI 插槽，供独立机构插件使用。
- 认证后刷新登录、账户和模型选择状态，注销期间拒绝迟到状态写入。
- 请求准备保留所配置的思考能力和模型级默认值。

## [0.1.0] - 2026-09-06

### 变更

- 兼容基线精确更新至 DeepSeek Harness `0.1.2-rc.1`（`a66e4702…`），不再声明支持 alpha.2 组合。
- 扩充并锁定 DSH peer 闭包，显式包含声明 `settings.general.item` 的页面包，避免 npm 在未锁定宿主中混装 alpha.2 与 rc.1。
- 逐项核对 Credential Provider、Settings、LLM/Pi Provider、WebServer、API Remotes、Typert 和 Client 页面插槽；新增 `check:dsh` 自动契约检查。
- Provider 配置只输出已声明字段，并复制为 rc.1 Settings/PiAi schema 可解析的可变数据；同时将 reasoning/compat 值域收紧到 rc.1 支持集合。
- Settings section 增加可服务性校验，阻止 schema 虽可解析、但无法构造企业 Provider 的配置被持久化。
- Provider 包装器补齐 `imageRequestPricing` 委托，并沿用 rc.1 官方附件到执行环境只读路径的解析链路。
- 企业品牌单插槽使用显式负优先级覆盖 rc.1 官方品牌项，避免与默认优先级 0 冲突而中断 Client 初始化。
- npm 包版本稳定为 `@eduwork/dsh-oidc@0.1.0`；保留 `dsh-oidc/v1alpha1`、`oidcAccounts`、凭据引用、Provider 标识、设置命名空间和用户数据。
- CI 扩展为 Windows/Linux 上的 Node.js 22/24 矩阵，并增加默认只检查/打包、显式授权后才通过 npm Trusted Publishing 发布的手动工作流。
- 文档链接和敏感信息检查显式忽略已被 Git 排除的 `dist/` 验收产物，避免本地缓存影响源码检查结果。
- 发布治理如实记录初期单一维护者模式，以独立技术复核、CI/专项回归和维护者决定留痕；Trusted Publisher 尚未配置时，首次 npm 发布使用浏览器 2FA 且不声称 provenance。
- npm 包补齐行为准则、贡献、安全、支持、治理和维护者双语文档，避免 README 在安装包内出现悬空的相对链接。
- 测试入口固定到仓库 `test/*.test.js`，避免被 Git 忽略的本地验收快照改变测试发现范围和计数。

## [0.1.0-alpha.11] - 2026-09-05

- npm 包身份改为 `@eduwork/dsh-oidc`，同步安装路径、组合模块路径与客户端注册。
- 保留 `dsh-oidc/v1alpha1`、`oidcAccounts`、凭据引用、Provider 标识和插件行 id；Host 与 Client 的 TYPERT 包归属一起更新。
- 旧无作用域版本保留可安装，并提供 Profile 迁移说明。


## [0.1.0-alpha.10] - 2026-08-31

### 变更

- 兼容基线更新至 DeepSeek Harness `0.1.2-alpha.2`（`0a53fb55…`）与 `@deepseek-ai/cordis` `4.0.2`。
- Provider 设置接入迁移到 alpha.2 官方 `SettingsProvider.installSection()`；不再依赖已删除的 `installSettingsSection` 与 `settingsNamespace` 顶层导出。
- npm 与锁定源码 release-pack 两种 DSH Runtime 均完成构建、单元测试、协议/文档/敏感信息和发布内容检查。

## [0.1.0-alpha.9] - 2026-08-31

### 变更

- 删除 `catalogPathEnv`、`activeInstitutionEnv` 和产品机构目录转换代码。Web 与 native 后端现在都只接受标准 Enterprise Profile；任何产品自有目录必须由产品装配层先转换。
- Native `enterpriseAccounts` 继续作为可选的通用宿主能力接口，不依赖 Wails、Electron 或任何产品数据格式。

## [0.1.0-alpha.8] - 2026-08-31

### 新增

- 增加中英文[服务端接口规范](docs/server-integration-contract.md)，按接口说明形式定义 OIDC + PKCE、Key Binding 和模型网关这一完整机构服务必须共同交付的能力。
- 中英文文档默认入口、公开仓库地址、维护者和私密安全报告入口完成开源化整理。

### 变更

- Web 回调固定为 `http://127.0.0.1:<DSH端口>/oauth/callback`，不再接受公网 `publicBaseURL` 或非 `127.0.0.1` 的 DSH WebServer。
- Enterprise Profile 新增可选 `keyBinding.credentialRef`，让生产与测试在保持同一 Provider ID/服务端协议的同时隔离本地 DSH 凭据；省略时继续按 Provider ID 派生，旧配置无需迁移。
- 宿主提供的凭据引用现在必须进入同一通用 Profile 字段，不再允许宿主与 Provider 分别决定读取位置。
- 示例与测试只使用保留文档地址，公开主分支不继承内部开发提交历史。

### 安全

- Native 宿主若报告与 Enterprise Profile 不一致的凭据引用，插件会失败关闭，避免生产/测试环境交叉读取 API Key。

## [0.1.0-alpha.7] - 2026-08-30

### 新增

- 仅限开发环境的网络 HTTP 部署可以显式允许一个精确 `insecureDevelopmentOrigin`；默认仍强制 HTTPS，loopback 开发行为不变。

## [0.1.0-alpha.6] - 2026-08-29

### 变更

- 兼容基线更新至 DeepSeek Harness `0.1.2-alpha.1`，并用公开 renderer/session 时代软件包替换已移除的 Client runtime peer。
- 企业模型管理现在通过官方 `settings.models.footer` 扩展上游“模型”页面；产品不再需要 fork 完整模型设置页。
- 通过源码 release-pack Runtime 审查 pi-ai `0.84.4`，同时保留兼容的 `^0.84.2` peer 范围。

## [0.1.0-alpha.5] - 2026-08-26

### 变更

- 在仓库所有权确定前，安装文档改为从经过审查的本地 Git checkout 开始，并使用 GitHub 组织占位符。
- 明确本地路径安装会把 checkout 链接进 DSH Profile，不会扫描当前工作区，并要求 checkout 持续存在。
- Registry 安装只作为 npm 版本经过审查并发布后的未来路径。

## [0.1.0-alpha.4] - 2026-08-26

### 新增

- 通过包自带的 Web-first `cordis.patch.yml`，支持 `dsh plugin --profile web add dsh-oidc` 直接安装 DSH Bundle。
- 完整中英文第三方接入指南，覆盖 OIDC 注册、Key Binding 实现、Enterprise Profile、Web/native 组合、生产验收和排障。

### 变更

- 可发布 npm tarball 现在包含无需仓库 checkout 即可部署插件所需的协议和部署文档。

## [0.1.0-alpha.3] - 2026-08-25

### 新增

- Web 与 native DSH 组合共用、可感知能力的企业 Provider/模型设置组件，通过 DSH 官方 `settings.section` 扩展点注册。
- 版本化 `dsh-oidc/management/v1alpha1` 浏览器投影，以及可选 native 新增、切换、模型编辑和重启操作。
- `models-only` UI 模式，使桌面产品在保留独立账号、配额、更新和诊断界面的同时继承共用模型设置。

### 变更

- 纯 Web 现在通过与 Desktop 相同的 Provider/模型 UI 展示受信任 Enterprise Profile，并隐藏修改操作。
- 已认证但仍缺少运行凭据的账号会显示明确“确认并连接”操作，而不是重复 OIDC 登录。

## [0.1.0-alpha.2] - 2026-08-25

### 变更

- 账号界面显示标准 OIDC UserInfo `name`，缺失时降级到 `sub`；机构品牌仍作为次要上下文。
- Native desktop adapter 应提供与 Web 后端相同的 `userName` 身份契约；私有管理面 bootstrap 数据不得替换 OIDC 身份。

## [0.1.0-alpha.1] - 2026-08-25

### 新增

- 独立 `dsh-oidc` 软件包，不依赖 ChatECNU 私有包。
- OIDC Authorization Code + PKCE Web 后端和 native 账号 adapter。
- 标准 UserInfo 身份（`name`，降级 `sub`）和 subject 绑定。
- 固定 `worker-user-center-v1` Key Binding 客户端和 OpenAPI 契约。
- 声明式 Enterprise Profile JSON Schema、品牌替换、Provider/模型目录和 ECNU 占位示例。
- 本地 DSH/PiAi OpenAI-compatible Provider adapter 和 `enterpriseTransforms` 扩展点。
- 中英文账号 UI 降级文案。
- 安全、治理、贡献、兼容、发布和第三方文档。

### 安全

- 精确 callback/public-origin 处理、同源 return path 和重复 callback 参数拒绝。
- 多 audience `azp`、JWK 元数据/唯一性、必需时间 claim、可选 `at_hash` 和 UserInfo subject 校验。
- 支持跨 origin HTTPS Discovery endpoint；HTTP 仅限 loopback 开发环境。
- 限制 Profile 和网络响应大小，严格拒绝未知字段和 SVG data logo。
