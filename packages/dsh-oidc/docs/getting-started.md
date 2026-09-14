# 接入指南：把企业 OIDC 与模型服务接入 DSH

**简体中文** | [English](getting-started.en.md)

这份指南面向准备在自己机构部署 `dsh-oidc` 的管理员和开发者。完成后，用户可以在普通 DSH Web 中：

1. 使用机构 OIDC 登录；
2. 明确确认创建或绑定模型运行凭据；
3. 在“企业服务”设置页查看账号、Provider 和模型；
4. 直接选择企业模型开始对话；
5. 刷新登录、检查连接或退出登录，而模型 API Key 不进入浏览器配置。

`dsh-oidc` 不要求 Wails，也不要求使用 ChatECNU Work。华东师范大学只是参考实现。

## 1. 先确认你需要准备什么

| 组件 | 谁提供 | 最低要求 |
| --- | --- | --- |
| DSH Host | 部署方 | 本版基线 DeepSeek Harness `0.1.5-rc.1`，Node.js 22+；不要与历史稳定包混用。 |
| 机构企业模型集成服务 | 同一服务所有者 | 纯身份档提供 OIDC；托管模型档再联合提供固定 Key Binding 与 OpenAI-compatible 模型网关。 |
| Enterprise Profile | 部署方 | 一份受信任的本地 JSON，只存公开配置，不存密钥或个人信息。 |
| Credential Provider | DSH Host | 当前 Web backend 仅支持可信单用户本机存储。 |

先把[服务端接口规范](server-integration-contract.md)交给身份平台与模型平台共同确认。只有 OIDC 时，插件只能证明“用户是谁”；没有 Key Binding 和模型网关，就无法安全完成“这个用户可以调用哪些企业模型”的闭环。不要把全局模型 API Key 写进 Enterprise Profile。

## 2. 注册 OIDC Public Client

在机构身份平台登记一个不带 Client Secret 的 Public Client。回调地址必须逐字符匹配：

```text
http://127.0.0.1:3080/oauth/callback
```

以下固定端口用于本机 Web 验证。新桌面默认临时随机端口，固定端口 IdP 的配置方法见 [桌面宿主接入](desktop-host.md)。`127.0.0.1` 和 `/oauth/callback` 固定不可配置。`3080` 是推荐的 DSH 端口；若修改 DSH WebServer 端口，OIDC 注册值必须使用相同端口。不要登记 `localhost`、局域网地址或公网地址。

OIDC Provider 必须通过 Discovery 发布 `authorization_endpoint`、`token_endpoint`、`jwks_uri` 和 `userinfo_endpoint`，支持 PKCE `S256`，并返回：

- ID Token：至少包含正确的 `iss`、`aud`、`sub`、`iat`、`exp` 和 `nonce`；当前版本只支持带 `kid` 的 RS256；
- UserInfo：必须包含与 ID Token 相同的非空 `sub`；建议提供标准 `name` 作为用户显示名；
- Access Token：可以是 JWT 或 opaque token，但 Key Binding 服务必须能验证 issuer、audience、有效期、scope 和 subject。

插件只读取标准 `userinfo.name`，缺失时显示 `userinfo.sub`。它不会读取私有人员接口，也不支持 JSON Path 姓名映射。完整兼容要求见 [OIDC 兼容规范](oidc-interoperability.md)。

## 3. 实现完整机构服务端

本节针对托管企业模型能力：需要上一节的 OIDC、下面的 Key Binding，以及接受绑定凭据的 OpenAI-compatible 模型网关。纯身份档可跳过本节。它们可以由内部不同系统承载，但必须有统一的版本、安全和运维责任。接口定义见[服务端接口规范](server-integration-contract.md)。

Key Binding 不是 OIDC 标准的一部分，而是 `dsh-oidc` 定义的企业模型凭据协议。Enterprise Profile 用 `baseURL` 指定接口组基址，插件固定调用：

```text
GET  {baseURL}/bootstrap
POST {baseURL}/runtime-credential/provision
POST {baseURL}/runtime-credential/resolve
POST {baseURL}/runtime-credential/renew
```

Profile 还可以用可选的 `keyBinding.credentialRef` 隔离本地 DSH Credential Provider 中的秘密条目。它不参与网络请求，也不改变下列接口；默认统一为 `EDUWORK_API_KEY`，也接受同名显式配置；只有需要独立管理的自定义引用才另行指定。旧自动名称兼容迁移和身份归属校验见 [Profile 规范](enterprise-profile.md)。

每个请求都携带 OIDC Access Token：

```http
Authorization: Bearer <oidc-access-token>
```

服务端必须验证 Access Token 和用户授权，不得只相信请求里的 `provider_id`。`provision` 与 `renew` 还必须支持 `Idempotency-Key`。返回的 `api_key` 只能通过 TLS 响应一次性交给插件，必须带 `Cache-Control: no-store`，不得进入日志、监控标签或错误详情。

规范文本见 [Key Binding 协议](key-binding-protocol.md)，可直接交给后端研发的机器可读契约是 [`protocol/openapi.yaml`](../protocol/openapi.yaml)。OIDC 和模型网关分别遵循其既有标准，因此本项目不复制另一份 OpenAPI。

## 4. 创建 Enterprise Profile

复制 [`examples/enterprise-profile.example.json`](../examples/enterprise-profile.example.json)，至少替换：

- `id`、`displayName`、`organization`；
- `brand` 中有权使用的名称、颜色和支持地址；
- `oidc.issuer`、Public `clientId` 与 scopes；
- `keyBinding.baseURL`；
- 跨环境需要隔离本地 Key 时，可选配置 `keyBinding.credentialRef`；
- `provider.id`、OpenAI-compatible `baseURL` 和模型列表。

典型结构如下：

```json
{
  "schemaVersion": "dsh-oidc/v1alpha1",
  "id": "example-university",
  "displayName": "Example University AI",
  "organization": "Example University",
  "brand": {
    "productName": "Example AI Work",
    "organizationName": "Example University",
    "mark": "E",
    "primaryColor": "#5157af",
    "loginTitle": "使用机构账号登录",
    "loginDescription": "登录后绑定企业模型运行凭据。",
    "supportURL": "https://support.example.edu/ai"
  },
  "oidc": {
    "issuer": "https://id.example.edu/oidc",
    "clientId": "dsh-web-public-client",
    "scopes": ["openid", "profile", "offline_access"]
  },
  "keyBinding": {
    "baseURL": "https://ai.example.edu/api/worker/v1"
  },
  "provider": {
    "id": "example-ai",
    "displayName": "Example AI",
    "adapter": "openai-compatible",
    "baseURL": "https://ai.example.edu/open/api/v1",
    "models": [
      { "id": "example-max", "name": "Example Max", "input": ["text"] },
      { "id": "example-plus", "name": "Example Plus", "input": ["text", "image"] }
    ]
  }
}
```

Profile 是部署配置，不是用户输入。它可以声明模型事实和有限品牌 token，但不能加载脚本、CSS、工具、Skill 或远程 Provider adapter。字段全集和安全限制见 [Enterprise Profile 规范](enterprise-profile.md)。

## 5. 安装到本机 DSH Web

本版采用精确的 `0.2.0` 与统一 DSH `0.1.5-rc.1`。发布状态以 npm registry 为准；若准备期间尚未发布，使用本地冻结候选或下方源码方式，不混装旧 DSH 依赖。

`dsh-oidc` 本身是可直接安装的 DSH Bundle。团队部署应从 npm 安装经过复核的精确版本：

```bash
dsh plugin --profile web add @eduwork/dsh-oidc@0.2.0
```

需要审计、开发或测试尚未发布的改动时，再从本地 checkout 安装：

```bash
git clone https://github.com/ecnu/EduWork.git
cd EduWork/packages/dsh-oidc
npm ci
npm run check
dsh plugin --profile web add .
```

也可以在项目父目录中显式传入相对路径：

```bash
dsh plugin --profile web add ./EduWork/packages/dsh-oidc
```

DSH 会把本地 checkout 链接到 `$DSH_HOME/profiles/web`，不会扫描或复制当前目录；安装完成后不要移动或删除 checkout。源码部署应固定经过审核的 commit。生产或团队 Profile 应使用精确 npm 版本，不要混装其他 DSH 预发布线。

设置 Enterprise Profile 路径，并让 DSH 监听固定 loopback host：

```bash
export EDUWORK_OIDC_PROFILE=/etc/dsh/enterprise-profile.json
dsh --profile web --host 127.0.0.1 --port 3080 --no-open
```

PowerShell 示例：

```powershell
$env:EDUWORK_OIDC_PROFILE = 'C:\dsh-config\enterprise-profile.json'
dsh --profile web --host 127.0.0.1 --port 3080 --no-open
```

插件会从 DSH WebServer 的端口构造 `http://127.0.0.1:<port>/oauth/callback`，不接受 `publicBaseURL`，也不会从代理 header 推断地址。若启动参数改变端口，必须同步修改 OIDC Public Client 的登记值。

安装命令会把 `dsh-oidc` 作为 Bundle 加到 Profile，并由包内 `cordis.patch.yml` 挂载插件。它不会遍历当前工作目录，也不会替换 DSH 的 Web、会话、Workspace、LLM、Credential Provider 或其他官方能力；当前目录只用于解析 `.`、`./EduWork/packages/dsh-oidc` 等相对安装路径。

## 6. 高级组合：自定义 Bundle 或桌面宿主

如果产品已有自己的 Bundle，可以不使用包内默认 patch，而是在产品 patch 中显式插入：

```yaml
- insert:
    - id: enterprise-oidc
      name: '@eduwork/dsh-oidc'
      config:
        profilePathEnv: EDUWORK_OIDC_PROFILE
        web:
          returnPath: /
```

仅为兼容旧宿主，仍保留以下 native backend 示例：

```yaml
- insert:
    - id: enterprise-oidc
      name: '@eduwork/dsh-oidc'
      config:
        backend: native
        uiMode: models-only
        profilePathEnv: PRODUCT_ENTERPRISE_PROFILE
```

上面是旧版 `native` 桥接示例；新 Wails/Electron 组合应使用 `backend: desktop`，共用临时 loopback 回调与官方 `nativeCommand`，无需另写认证桥。见 [桌面 Host 集成](desktop-host.md)。旧 native backend 必须提供 `enterpriseAccounts` 服务，并与 Web 一样传入标准 Enterprise Profile。产品自有目录、租户或账号配置必须先由产品装配层转换为该 Profile，不能交给 `dsh-oidc` 解释。宿主可以由 Wails、Electron、Tauri 或其他技术实现；插件本身不依赖任何桌面框架或产品目录格式。接口和能力探测见 [DSH 集成说明](dsh-integration.md)。

## 7. 上线前验收

至少完成以下真实链路：

1. `dsh --profile web --dump-config` 中只有一个 `enterprise-oidc` 实例；
2. 登录跳转和 `/oauth/callback` 成功，错误 state、重复参数和过期 code 会失败；
3. 设置页显示标准 UserInfo `name`，没有 `name` 时显示稳定 `sub`；
4. 未创建运行凭据时先显示用户确认，不自动静默 provision；
5. provision/resolve 后企业模型可完成流式对话；
6. API Key 不出现在 Profile、浏览器配置、日志和导出的会话中；
7. refresh、过期、撤销、权限不足、限流和 Key Binding 不可用均有可理解的失败结果；
8. logout 清理本地 OIDC 会话和模型凭据，并尽力调用标准 revocation endpoint；
9. DSH WebServer 只监听 `127.0.0.1`，没有通过反向代理或端口映射暴露为共享站点；
10. OIDC、全部四个 Key Binding 操作和模型网关按[服务端接口规范](server-integration-contract.md)联合通过验收。

当前 Web backend 不支持共享 Web。需要共享场景时必须由具备每用户隔离的新宿主 backend 承担，不能直接放宽 loopback 约束。详见 [安全模型](security-model.md) 和 [公开发布检查表](release-checklist.md)。

## 8. 常见问题

### 回调失败或跳回后仍未登录

核对 OIDC 注册值是否与 `http://127.0.0.1:<DSH端口>/oauth/callback` 完全一致。确认 DSH 实际监听 host 为 `127.0.0.1`，登记端口与启动端口相同；不要使用 `localhost`、局域网地址或公网地址。

### 页面显示一串 subject，而不是姓名

这是标准降级行为。让 OIDC UserInfo 在 `profile` scope 下返回非空标准 `name`，并保证 `sub` 与 ID Token 完全一致。

### 登录成功但模型不可用

检查 Key Binding 的 `/bootstrap` 状态、用户是否确认 provision、返回的 `provider_id` 是否等于 Enterprise Profile 的 `provider.id`，以及模型网关是否接受绑定后的 API Key。

### 模型支持 thinking，但不支持 reasoning effort

在模型 `compat` 中设置：

```json
{ "supportsReasoningEffort": false }
```

插件会保留 thinking 行为并移除不受支持的 effort 参数，不会因此拒绝调用。

### 企业服务设置在哪里

插件通过官方 `settings.models.footer` 插槽显示已配置机构，保留官方“模型”设置页和个人 API Key。机构配置来自发行方的可信文件；产品可以提供打开配置文件的入口，插件不提供任意创建或修改机构端点的表单。
