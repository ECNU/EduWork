# 网关认证接入

**简体中文** | [English](README_EN.md)

LiteLLM native OAuth 和默认关闭的 [oidc-llm 实验适配器](experimental-oidc-llm.md) 已随 `@eduwork/dsh-oidc@0.3.0-dev.2` 发布，并包含在 EduWork `0.3.6-dev.20260921.1` 中。仅身份 oidc 配置保留；旧 Key Binding 模型流程已移除，迁移见[说明](../key-binding-protocol.md)。**oidc-llm** 仍是[协议草案](oidc-llm-draft.md)，实验实现不代表协议已定稿。

## 选择接入方式

配置已有 LiteLLM 网关请从 [LiteLLM 接入指南](litellm-setup.md)开始；本页描述底层协议和宿主集成要求。

| 服务端 | 配置 | 模型凭据 | 客户端注册 |
| --- | --- | --- | --- |
| 纯身份 OIDC | 仅 oidc，不配置 provider | 无机构模型凭据 | 预注册 public client |
| LiteLLM 1.101.0 native contract 1 | `auth.discoveryUrl` | 登录返回的 Access Token | 每次登录动态注册实际本机回调 |
| oidc-llm 0.1 实验 | `auth` + 显式实验开关与身份模式 | Access Token | 已实现预注册 public client |

LiteLLM 不需要实现 EduWork 的 Key Binding。普通 OIDC 的 Access Token 也不会因为配置了模型 URL 就获得推理权限；须配置明确的 Token 网关契约。配额和团队管理不纳入本次统一协议；LiteLLM 自己的团队选择留在网关网页，客户端仅保存不透明的授权上下文用于防止刷新串号。

## LiteLLM 配置

在含本功能的构建中，把下列对象放入 `config/eduwork.jsonc` 的 `organizations` 数组；直接使用插件时放入 `profiles`。完整示例见 [Enterprise Profile](../../examples/litellm.enterprise-profile.example.json)。

```json
{
  "schemaVersion": "dsh-oidc/v1alpha1",
  "id": "example-gateway",
  "displayName": "示例模型网关",
  "auth": {
    "discoveryUrl": "https://gateway.example.org/.well-known/litellm-cli-auth",
    "expectedIssuer": "https://gateway.example.org"
  }
}
```

`allowInsecureDevelopment` 是唯一的 HTTP 开关，放在企业对象中，与 `auth`/`oidc` 同级；默认 `false` 仅接受 HTTPS，改为 `true` 也接受 HTTP 服务地址。旧 `insecureDevelopmentOrigin` 已废弃并忽略。issuer 身份、资源同源关系及 OAuth/PKCE 校验仍按协议执行。`discoveryUrl` 填完整发现地址，`expectedIssuer` 可选，填写后必须与发现文档完全一致。

`auth` 与 `oidc`、`keyBinding` 互斥；LiteLLM 配置不填写固定 `clientId`、secret、scope 或 `provider.baseURL`。模型 API 基址由已校验的 issuer 追加 `/v1`，保留部署路径前缀。可选 `provider` 支持唯一的 `id`、显示名、上下文/输出限制和经管理员核实的 `models` 能力；只能使用 `modelSource: "discovery"`。模型能否出现由当前账户的 `/v1/models` 决定，配置里的模型信息只是能力补充，不会绕过授权。

普通 `/models` 只有 ID 时默认视为文本模型、不推测思考或图像能力。可用模型列表为空时保持空列表。读取失败显示目录暂不可用；不会沿用另一个账户的模型列表。

插件使用 `backend: "desktop"` 或本机 `backend: "web"`；旧 `native` 桥已移除。示例插件配置：

```json
{
  "backend": "desktop",
  "profilePathEnv": "EDUWORK_OIDC_PROFILE"
}
```

环境变量指向上述 Profile JSON 文件。桌面宿主须按[宿主接入指南](../desktop-host.md)提供 `desktopServices.openExternal` 和 Credential Provider；网页宿主保持既有本机单用户边界。

## LiteLLM native contract 1 接口

以下描述对应 **LiteLLM v1.101.0**，不是我们要求 LiteLLM 实现的新协议。端点名称来自发现响应，表中的路径为该版本默认部署示例。

### 1. 发现

无凭据 `GET /.well-known/litellm-cli-auth`，成功 200：

```json
{
  "contract_version": 1,
  "issuer": "https://gateway.example.org",
  "authorization_endpoint": "https://gateway.example.org/authorize",
  "token_endpoint": "https://gateway.example.org/token",
  "registration_endpoint": "https://gateway.example.org/register",
  "revocation_endpoint": "https://gateway.example.org/revoke",
  "resource": "https://gateway.example.org",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"]
}
```

客户端核对所有必需能力和 URL，未知版本、缺失能力、混入 `oidc_llm` 标志均报错。不能仅根据域名、一个 `contract_version` 字段或没有 ID Token 来猜协议。配置/端点绑定变化后，旧 Token 不发送到新服务。

### 2. 动态注册

先绑定 `127.0.0.1` 临时端口，再向 registration endpoint 发 JSON POST：

```json
{
  "client_name": "EduWork",
  "redirect_uris": ["http://127.0.0.1:53187/oauth/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}
```

成功 201，返回 `client_id`、`client_id_issued_at`、`redirect_uris`、`token_endpoint_auth_method`、`grant_types` 和 `response_types`。回调必须与注册请求一致。该版本允许 1–3 个回调，每个至多 256 字符；EduWork 只注册本次实际回调。`client_id` 是网关签发的 opaque 注册标识，不是用户 ID；不能用任意字符串代替。刷新复用原 client ID，不重新注册。

### 3. 浏览器授权

GET authorization endpoint，参数：

| 参数 | 客户端值 |
| --- | --- |
| `response_type` | `code` |
| `client_id` | 注册返回值 |
| `redirect_uri` | 与注册精确一致 |
| `state` | 每次随机，回调必须匹配，只消费一次 |
| `code_challenge` / `code_challenge_method` | PKCE SHA-256 / `S256` |
| `resource` | 发现响应原值 |

必须发送 `resource`，否则该版本可能进入 MCP 授权路径。Native 流程不提供 OIDC 的 nonce/ID Token 校验，也未按应用 scope 实现权限隔离，客户端不发送虚构的 `openid` 或自定义模型 scope。

用户在网关登录、选择网关支持的授权上下文并同意后，浏览器返回 `code` 与 `state`；拒绝返回 `error=access_denied` 与 `state`。无效 client/回调可能直接收到 JSON 错误。授权页面及其内部 `/authorize/complete` 由 LiteLLM 管理，不属于 EduWork Host 调用的认证 API。

### 4. 换码与刷新

向 token endpoint 发 `application/x-www-form-urlencoded` POST：

| 操作 | 表单字段 |
| --- | --- |
| 换码 | `grant_type=authorization_code`、`client_id`、`code`、`redirect_uri`、`code_verifier`、`resource` |
| 刷新 | `grant_type=refresh_token`、`client_id`、`refresh_token`、`resource` |

成功 200，两种操作均返回：

```json
{
  "access_token": "OPAQUE_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "OPAQUE_REFRESH_TOKEN",
  "user_id": "example-user",
  "team_id": null
}
```

Access Token 是不透明凭据，不能自行解析为 JWT。`user_id` 是非空字符串，`team_id` 是字符串或 null，二者在刷新后必须保持一致；不一致要求重新登录。`expires_in` 以响应为准：上例 1 小时仅为示例，该版本默认 24 小时且可配置。Refresh Token 每次轮换、单次使用，其 14 天期限随新签发重新计算，不是整个登录的绝对寿命。

Host 在临近到期时刷新，同一授权的并发请求共用一次刷新，将新 Token 对整体保存后再使用。失败的目录读取、403、429、5xx 不会一概清除登录；明确 `invalid_grant`/`invalid_client` 或刷新身份改变才要求重新登录。重定向不会携带 code/token 自动跟随。已经开始的生成和 SSE 不因认证失败而由本层自动重放。

模型请求在准备时绑定当前授权。退出或更换账户/授权上下文后，已准备但尚未发送的请求不能改用新账户凭据；正在接收的请求会取消，迟到的正文与流式内容不再交给调用方。相同授权内的 Token 刷新不会中断生成。这是客户端的本地隔离，不代表网关已立即撤销 Access Token，也不保证上游推理或计费同步停止。

### 5. 用户资料与模型

| 请求 | 鉴权与处理 |
| --- | --- |
| `GET /user/info` | Bearer Access Token；返回 `user_id`、`user_info` 等。只接收匹配主体的 `user_info.user_alias` 作为可选显示名；失败降级为 Token 响应的 user ID |
| `GET /v1/models` | Bearer Access Token；OpenAI 风格 `data` 数组，每项 `id`。用于当前授权的模型目录 |
| `POST /v1/chat/completions` | 相同 Bearer；普通 JSON 或 `stream=true` 的 SSE（含 `[DONE]`），复用 DSH 模型适配器 |

`/user/info` 是 LiteLLM adapter 的固定映射，native discovery 没有 `userinfo_endpoint`。其完整响应可能包含 Key、团队、预算等管理信息，不能直接传给 UI、日志或诊断包。模型 Token 不写成长期 `EDUWORK_API_KEY` 副本；主会话与子代理在实际请求时共用 Host 的有效凭据解析入口。

### 6. 撤销与错误

POST revocation endpoint，表单 `token=<refresh_token>&client_id=<registered_client>`。该版本以 200 `{}` 返回撤销结果；有效 client 下未知、过期、重复的 Token 可得到相同成功形状。非法 client 返回 401；协调服务或其他服务器异常可能返回 503/500。

**只撤销提交的 Refresh Token，不能宣称立即撤销全部 Access Token 或整个刷新家族。** Access Token 仍按网关有效期处理。客户端退出先清除本地授权及模型目录，再尝试远端撤销；远端失败记录不含凭据的警告，不阻止本地退出。当前客户端没有跨重启的待撤销重试队列。

常见 OAuth 错误为 400 的 `invalid_request`、`invalid_grant`、`invalid_target`、`unsupported_grant_type`；参数结构错误也可能是 FastAPI 的 422。403 表示请求无权限；429/5xx 为独立的资源/服务错误，不能解释成必定需要重新登录。用户 Token 的实际权限由该版网关决定，不宣称已限制为“仅模型推理”。

## 现有 OIDC 与后续迁移

纯身份 OIDC 与 oidc-llm 的 OIDC 模式共用 Discovery issuer、PKCE S256、state、nonce、RS256 ID Token 和 UserInfo sub 一致性校验。Key Binding 与旧凭据引用迁移已移除，模型授权改用网关 Token。相关接口见[服务端契约](../server-integration-contract.md)、[Profile 规范](../enterprise-profile.md)。没有为兼容 LiteLLM 放松这些检查。

新 oidc-llm 的 UserInfo 从发现的 `userinfo_endpoint` 获取，复用标准主体和资料字段。实验配置及实际限制见[实验接入](experimental-oidc-llm.md)，尚待讨论的 scope、生命周期和撤销保证见[草案](oidc-llm-draft.md)。真实服务完成验收前，不迁移已有机构配置。

## 开发验证

包内执行 `npm ci`、`npm run check`。合成测试覆盖纯身份 OIDC、安全发现、真实 loopback、刷新竞争、账户切换、目录隔离和错误行为；真实 LiteLLM 联调需单独运行本地网关并完成浏览器登录、普通/SSE、刷新、重启和退出验收。HTTP 同意页驱动、模拟到期或 mock 模型不等价于完整桌面、自然到期或真实推理验收。测试账号和 Token 不进入公开仓库。

官方依据：[v1.101.0](https://github.com/BerriAI/litellm/releases/tag/v1.101.0)、[native flow](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/proxy/_experimental/mcp_server/gateway_dcr_flow.py)、[HTTP routes](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/proxy/_experimental/mcp_server/discoverable_endpoints.py)、[proxy credentials](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/proxy/_experimental/mcp_server/proxy_api_credentials.py)。
