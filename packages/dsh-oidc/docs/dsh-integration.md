# DSH 集成与扩展边界

**简体中文** | [English](dsh-integration.en.md)

## 支持的宿主基线

当前 `0.2.0`以 npm 已发布的 DSH `0.1.5-rc.1` 闭包作为开发/CI 基线。历史稳定版 `0.1.0` 对应 `0.1.2-rc.1`；其他旧候选证据分别记在[兼容性矩阵](compatibility.md)。不要混装 DSH 版本。干净安装见[开发准备](development.md)。

插件只使用公开 package export，不复制 DSH 源码：

| DSH 服务/软件包 | 用途 |
| --- | --- |
| `dsh-typert-protocol` | Host/Client RPC 描述符。 |
| `dsh-host-webserver` | 精确 `/oauth/callback` 路由。 |
| `dsh-credentials` | Session 和运行时 API Key 存储。 |
| `dsh-llm` | Adapter 注册、凭据、重试策略和稳定错误。 |
| `dsh-llm-pi-ai` | 官方 `PiAiAdapter`。 |
| `dsh-settings` | Provider 目录和就绪状态。 |
| `dsh-launch-environment` | Credential Provider 服务不存在时的凭据降级。 |
| Client runtime/remotes/slots/theme | 浏览器 bundle 和有边界的 UI/品牌表面。 |

OpenAI-compatible 网络实现来自 `@earendil-works/pi-ai`，它也是 DSH 官方 Pi adapter 的基础。

## 为什么 Provider adapter 位于本包内

只有 OIDC 认证还不能获得可调用的企业模型。闭环集成还需要稳定 Provider 路由，并确保其凭据引用与 Key Binding 输出一致。再发布一个机构特有 Provider 包，会重新制造本仓库要消除的耦合。

因此 adapter 是 `dsh-oidc` 内部模块，但其行为受到严格约束：

- 只有一个经过审查的 `openai-compatible` 实现；
- 只接受声明式 Provider/模型事实；
- 使用 DSH 官方 LLM 注册和 Pi adapter；
- 不维护第二套 HTTP 栈；
- 不自动发现环境中的 pi-ai 凭据；
- 重试策略和附件解析由 DSH 负责。

它仍以 `@eduwork/dsh-oidc/provider` 导出，供测试和高级本地组合使用，但 Enterprise Profile 无法替换它。

## Cordis 服务入口

默认导出为 `OidcAccountService`，这是名为 `oidcAccounts` 的 `TypertRemoteService`。远程方法包括：

| 方法 | 结果 |
| --- | --- |
| `configuration()` | 删除秘密和 endpoint 基址后的公开 Profile。 |
| `openConfiguration(target)` | 通过宿主打开配置/示例；不返回文件内容或秘密。 |
| `status(profileID)` | 本地 session/凭据状态。 |
| `begin(profileID)` | Web 重定向、临时 desktop 登录 ID 或旧 native 完成状态。 |
| `loginStatus(loginID)` / `cancelLogin(loginID)` | 查询或取消当前桌面登录。 |
| `resources(profileID)` | 模型元数据与问题，不含配额或秘密。 |
| `selectEnterpriseModel(profileID, options)` | 通过官方默认值选择已验证连接的模型，不接受任意 Provider 目的地。 |
| `reconcile(profileID, {allowProvision})` | 执行 bootstrap 和 resolve/provision/renew。 |
| `logout(profileID)` | 本地清理，并尽力执行 OIDC 撤销。 |
| `management()` | 共用企业模型设置 UI 使用的宿主能力投影。 |
| `activate/configure/addCustom/updateCustom/removeProfile/configureModels/restart` | 可选 native 管理操作；Web Profile 拒绝修改。 |

Client 描述符使用严格 Zod codec。发送给浏览器的配置不包含 issuer、client ID、Key Binding base、模型 base URL、Token 或 Key。

## Web 组合

### 直接安装

`dsh-oidc` 自带默认的 local-Web Bundle patch，可以直接从 npm 安装到官方 Web Profile，无需再编写 wrapper Bundle：

安装精确的 `0.2.0`，宿主 DSH 依赖应统一为 `0.1.5-rc.1`。发布准备期间若 registry 尚未提供该版本，使用下方源码或已核验的冻结产物。

```bash
dsh plugin --profile web add @eduwork/dsh-oidc@0.2.0
```

需要审计、开发或验证尚未发布的改动时，可以安装经过审查的本地 checkout：

```bash
git clone https://github.com/ecnu/EduWork.git
cd EduWork/packages/dsh-oidc
npm ci
npm run check
dsh plugin --profile web add .
```

本地路径安装会把 checkout 链接到 Profile，因此源码目录必须持续存在。它不会扫描当前工作区。团队部署应固定经过复核的 npm 精确版本；不要在同一 Profile 中混装其他 DSH 预发布线。

随包 patch 使用 `EDUWORK_OIDC_PROFILE` 挂载且只挂载一个 `enterprise-oidc` 实例。Web backend 要求 DSH WebServer 精确监听 `127.0.0.1`，并从实际端口构造固定 `/oauth/callback`；不接受公网回调源配置。patch 不硬编码 `agent-default-model`；完成显式登录/Key 绑定后，Client 使用官方选择接口应用已连接机构默认模型。重启后的恢复仅修复不可用默认值，不覆盖个人模型选择。旧 `DSH_OIDC_ENTERPRISE_PROFILE` 环境变量仍兼容。

### 产品自有 Bundle

```yaml
- id: agent-default-model
  config:
    provider: example-ai
    model: example-max

- insert:
    - id: enterprise-oidc
      name: '@eduwork/dsh-oidc'
      config:
        profilePathEnv: EDUWORK_OIDC_PROFILE
        web:
          returnPath: /
```

所属 DSH Profile/Bundle 还必须包含普通 Web 应用、credentials、LLM/Pi adapter 依赖、settings、attachment 服务和 Client 界面。`dsh-oidc` 不是完整 DSH 发行版。

OIDC 注册、Key Binding 实现、环境变量、验收和排障见[接入指南](getting-started.md)。

## Desktop 组合

新 Wails/Electron 产品使用 `backend: desktop`：插件管理临时 loopback 回调，通过官方 `nativeCommand` 打开浏览器。两壳共享身份、Key Binding 和模型行为；宿主仍提供凭据存储，无需另写 `enterpriseAccounts`。见[桌面 Host 集成](desktop-host.md)。

## 旧 native 桥兼容

以下 adapter 仅用于已有集成，不是新桌面的必做项：

```yaml
- insert:
    - id: enterprise-oidc
      name: '@eduwork/dsh-oidc'
      config:
        backend: native
        uiMode: models-only
        profilePathEnv: PRODUCT_ENTERPRISE_PROFILE
```

宿主提供 Cordis 服务 `enterpriseAccounts`。产品自有机构目录必须由宿主或装配层先转换为标准 Enterprise Profile；`dsh-oidc` 不读取或解释产品目录：

```ts
interface EnterpriseAccounts {
  status(institutionID: string): Promise<NativeStatus>
  login(institutionID: string, options: { allowProvision: false }): Promise<NativeStatus>
  reconcile(institutionID: string, options: { allowProvision: boolean }): Promise<NativeStatus>
  logout(institutionID: string): Promise<NativeStatus>
  configuration(): Promise<NativeManagement>
  activate(institutionID: string): Promise<NativeManagement>
  configure(institutionID: string): Promise<NativeManagement>
  addCustom(baseURL: string): Promise<NativeManagement>
  updateCustom(institutionID: string, baseURL: string): Promise<NativeManagement>
  removeInstitution(institutionID: string): Promise<NativeManagement>
  configureCustomModels(institutionID: string, mode: 'discovery' | 'manual', models: RuntimeModel[]): Promise<NativeManagement>
  restart(): Promise<{restarting: true}>
}
```

`NativeStatus` 可以包含 `displayName`、`organization`、`state`、`userName`、`affiliation`、`accessExpiresAt`、`runtimeCredentialRef`、`credentialReady`、`credentialState` 和 `capabilities`。`runtimeCredentialRef` 只是宿主状态回报；若提供，必须等于 Enterprise Profile 规范化后的 `keyBinding.credentialRef`。凭据命名策略属于 Profile，不属于 Wails、Electron 或其他宿主实现。

Native 身份后端只必须实现前四项生命周期操作。管理操作通过能力探测：缺少这些方法时，同一 UI 会保持为只读 Profile/模型查看器。这是宿主 adapter，不属于 OIDC 或 Key Binding 网络标准；Wails、Electron、Tauri、移动桥接或其他本地宿主均可实现。

浏览器公共投影版本为 `dsh-oidc/management/v1alpha1`，有意排除 Token 和凭据。Web Enterprise Profile 的所有修改能力为 false；native adapter 可以根据实际方法声明 `manageProfiles`、`manageModels` 和 `restart`。

## 模型能力转换

插件提供名为 `enterpriseTransforms` 的 Cordis 服务：

```js
const dispose = ctx.enterpriseTransforms.register({
  provider: 'example-ai',
  model: 'example-max',
  inputModalities: ['image'],
  when: ({ inputModalities }) => !inputModalities.includes('image'),
  transform: async (request, nativeModelInfo) => {
    // 返回将要发送给 Provider 的请求，不要原地修改 request/transcript。
    return request
  },
})
```

路由级转换先执行，模型级转换后执行。同一 scope 的重复注册会被拒绝。注册变化触发 `llm/adapters-updated`。

转换是可执行本地插件，必须单独审查，绝不会从 Enterprise Profile 加载。

## 机构适配器的凭据读取

显式安装的本地适配器可调用 `ctx.oidcAccounts.resolveBoundCredential(profileID, { credentialRef: "EDUWORK_API_KEY", runtimeBaseURL })`。`runtimeBaseURL` 必须精确等于该 Profile 已审查的模型服务基址；返回已同时验证 session、issuer/client ID、完整资源绑定和 Key 指纹的 DSH credential record，未满足条件则返回 `undefined`。适配器直接使用这份 record，不应在检查状态后另行解析同名 Key，避免两个读操作之间发生账户切换。此方法只在 Host 存在，没有 Typert/RPC 注册，也不属于服务端协议。适配器仍负责限制其请求目的地址；当前桌面/Web 后端支持该方法，旧 native 桥不会降级返回未经验证的 Key。

## DSH 升级流程

每次升级 DSH release candidate 或 stable 版本时：

1. 在分支中更新精确 peer version；
2. 对比上述公开 export 和相关类型；
3. 运行单元测试和打包测试；
4. 启动纯 Web DSH Profile，完成登录、provision、模型调用、刷新和退出；
5. 启动 Desktop/native 组合并比较用户可见行为；
6. 验证 Client loader 格式和 slot 名称；
7. 审查 DSH 官方能力是否已替代任何本地 adapter 代码；
8. 发布前在 `docs/compatibility.md` 记录结果。

DSH 仍处于 1.0 之前时，不应使用 semver 范围让该安全敏感插件静默升级到未经测试的 DSH 版本。
