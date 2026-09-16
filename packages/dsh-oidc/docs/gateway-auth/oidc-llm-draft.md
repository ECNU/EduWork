# oidc-llm 0.1 协议草案

**简体中文** | [English](oidc-llm-draft.en.md)

**状态：待评审，不作为已发布部署契约。** 本分支已有默认关闭的[实验适配器](experimental-oidc-llm.md)，实现范围与限制以其文档为准；服务端行为仍需单独实测。名称、扩展字段、scope、寿命和撤销要求尚未定稿；不是已发布的 OpenID 标准。现有 OIDC 接入继续使用[当前契约](../server-integration-contract.md)。[网关接入入口](README.md) · [English overview](README_EN.md#existing-oidc-and-the-future-draft)

## 1. 范围

浏览器登录后，桌面公共客户端用 Access Token 获取本人的资料、可用模型目录并调用模型。协议复用 OAuth Authorization Code、PKCE S256、loopback 回调和标准 OIDC 字段。基础 OAuth 模式不要求 ID Token；需要严格身份验证的完整 OIDC 模式仍必须验证 ID Token。

不定义 Key Binding、配额标准、团队管理、计费或远程插件执行。客户端和服务端不能把任意普通 OIDC Token 自动当作模型凭据。

## 2. 服务发现

配置提供完整发现地址和可选的 `expectedIssuer`，预注册机构另提供 public `clientId`。客户端不固定账号 API 路径。无凭据 GET 成功返回 200 `application/json`：

```json
{
  "issuer": "https://login.example.org",
  "authorization_endpoint": "https://login.example.org/oauth/authorize",
  "token_endpoint": "https://login.example.org/oauth/token",
  "revocation_endpoint": "https://login.example.org/oauth/revoke",
  "userinfo_endpoint": "https://models.example.org/userinfo",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["llm:profile", "llm:models:read", "llm:invoke"],
  "oidc_llm": {
    "version": "0.1",
    "resource": "https://models.example.org",
    "api_base": "https://models.example.org/v1",
    "identity_modes_supported": ["oauth"],
    "client_registration_methods_supported": ["static"]
  }
}
```

以上字段拟为基础模式必填。`version` 精确匹配支持版本；0.x 不承诺跨版本兼容。`resource` 只有一个，授权和 Token 请求必须原样发送。`api_base` 是可配置 API 前缀，追加 `/models` 和 `/chat/completions`，不是强制 `/v1`。本草案限定 api_base 与 UserInfo 同 resource 源；issuer 可以是独立登录域名。该同源约束属于本草案，不是标准 OIDC 的要求。

`userinfo_endpoint` 在标准 OIDC Discovery 中是推荐项，在本接入草案中提升为必填。发现元数据还须声明每一种实际支持模式的 scopes。标准发现地址按对应规范校验 issuer；配置 `expectedIssuer` 时必须完整字符串相等。未配置时，首次发现的 issuer 与发现地址同源；异源托管需要显式固定 issuer。

所有生产端点使用 HTTPS。发现和携带凭据的请求不自动跟随重定向；浏览器导航除外。认证端点来自可信发现，仅接收其角色对应的凭据；模型 Token 不被任意转发到发现提到的其他 URL。保存的授权绑定协议、issuer、resource、client、token/revoke/model 端点；配置或绑定改变要求重新授权，不能默默迁移旧 Token。

发现同时包含 LiteLLM 与 oidc-llm 标志、未知版本、HTML 或缺关键能力时停止，不通过关闭验签或换协议来降级。

## 3. 客户端注册

默认支持机构预注册的一个公共客户端，所有用户共用 client ID，但各自有独立授权。客户端不保存共享 client secret。允许的 loopback host/path 必须预注册；按照 RFC 8252 允许实际端口变化，不能接受任意回调地址。

可选动态注册需在 `client_registration_methods_supported` 中声明 `dynamic` 并提供 `registration_endpoint`。按 RFC 7591 接受 JSON POST：

```json
{
  "client_name": "EduWork",
  "redirect_uris": ["http://127.0.0.1:53187/oauth/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}
```

成功 201，返回已登记的 `client_id`、回调、认证方法、grants/response types 和可选签发时间。0.1 的自动动态注册只覆盖无 bootstrap secret 的 public 注册；需要注册凭据的机构先用预注册模式。注册可以有状态或无状态，不强制“每人一个 client”。刷新复用原注册。

## 4. 授权、换码与刷新

基础 OAuth 模式拟申请 `llm:profile`、`llm:models:read`、`llm:invoke`。分别授权本人资料、获准模型目录、模型调用，不包括管理 Key、用户、团队或账单。具体模型集合仍由授权决定；服务端必须实际约束权限，不能仅靠客户端自律。

浏览器 GET authorization endpoint，必须带 `response_type=code`、client ID、精确 redirect URI、至少 128 bit 随机 state、S256 challenge、resource 和 scopes。verifier 为 43–128 字符。用户看到应用、账户和申请权限，拒绝以 `error=access_denied&state=...` 回调。无效 client/回调直接返回错误，不重定向到未信任地址。

成功回调 `code` 和原 state。授权码不透明、有效期拟不超过 120 秒、单次成功兑换，绑定主体、client、redirect、PKCE、resource 和批准 scopes。

token endpoint 接受 form POST：

| 操作 | 必须字段 |
| --- | --- |
| 换码 | `grant_type=authorization_code`、`client_id`、`code`、`redirect_uri`、`code_verifier`、`resource` |
| 刷新 | `grant_type=refresh_token`、`client_id`、`refresh_token`、`resource` |

成功响应示例：

```json
{
  "access_token": "OPAQUE_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "OPAQUE_REFRESH_TOKEN",
  "scope": "llm:profile llm:models:read llm:invoke"
}
```

响应应 `Cache-Control: no-store`。客户端不假定 Access Token 是 JWT，以 `expires_in` 判断有效期，核对实际批准 scopes。拟要求 Access Token 不超过 15 分钟；具体上限和部署兼容性尚待确认。

Refresh Token 轮换、单次使用；成功时新 Token 对整体返回，授权主体/resource 不变，不扩大 scopes。服务端拟支持刷新家族重用检测和授权级撤销；客户端对同一授权合并并发刷新，保存新 Token 对后再使用。网络中断后的提交状态不确定，需要明确错误恢复策略，不能无边界重复提交旧 refresh。Token 生命周期、并发协调和持久化是服务端验收项。

## 5. UserInfo

GET 发现的 `userinfo_endpoint`，`Authorization: Bearer <access_token>`，成功 200 JSON：

```json
{
  "sub": "opaque-user-id",
  "name": "示例用户",
  "preferred_username": "example-user"
}
```

普通 JSON UserInfo **只要求非空字符串 `sub`**。`name`、`preferred_username`、`picture`、`email`、`email_verified` 使用 OIDC 标准含义、按权限可选；缺少姓名/头像不使登录失败。主体键为 issuer + sub，不能用邮箱或显示名替代。不同授权的模型和资料缓存隔离，不因同名账户而合并。

OAuth-only 模式提供 UserInfo 格式兼容扩展，不宣称完成 OIDC 身份验证。资料暂时不可用不等于模型授权一定失效；客户端不能自行解析未经验证的 Token 来填充身份。完整 OIDC 模式必须校验返回 sub 与已验证 ID Token 的 sub 相同。

## 6. 模型资源

- GET `api_base + /models`：Bearer，200 OpenAI 风格 `{"object":"list","data":[{"id":"example-chat","object":"model"}]}`，仅列当前授权可见模型。
- POST `api_base + /chat/completions`：相同 Bearer，使用 OpenAI-compatible 请求与普通 JSON/SSE（`data:`，最终 `[DONE]`）响应。
- 其他图像、音频、Responses 等能力需以后显式声明；不因“OpenAI-compatible”就假定全部支持。

上下文、输出上限、输入模态、思考能力等可选元数据的字段格式尚待确认。只有模型 ID 时不能推断图像或 reasoning 支持。本轮不定义配额接口。

## 7. 撤销与错误

revocation endpoint 按 RFC 7009 接受 form `token`、public `client_id` 和可选 `token_type_hint=refresh_token`。成功 200，未知或已失效 Token 保持幂等。拟要求撤销该授权的 Refresh Token 家族；Access Token 最迟随其短寿命失效，服务端可额外主动失效。不能宣传无条件、即时的全服务下线。

退出立即停止本地授权使用和相关缓存写回；撤销网络失败与本地退出分开报告。迟到的刷新/目录结果不能恢复已退出或被新账户替换的授权。

OAuth 错误沿用 `invalid_request`、`invalid_client`、`invalid_grant`、`invalid_scope`、`unsupported_grant_type`，resource 不匹配使用 `invalid_target`。401 表示凭据无效，403 表示无权限，429 表示限流，5xx 表示服务异常；不要用清空账户处理所有失败。模型请求开始输出后不得自动刷新并重放整个生成。错误响应不能泄露令牌、验证码或账户秘密。

## 8. 可选完整 OIDC 模式

服务端在 `identity_modes_supported` 中额外声明 `oidc`，提供标准 `jwks_uri`、签名算法与 OIDC 必需元数据。客户端显式选择该模式，请求 `openid profile`（按需 `email`）和模型 scopes，使用 nonce；不额外要求基础 OAuth 模式的 `llm:profile`。

客户端按 OIDC 规范验证签名、算法、issuer、audience/azp、nonce、时间及相关 Token 绑定，UserInfo sub 必须一致。缺少 ID Token 时失败，不能临时切回 OAuth-only。当前旧 OIDC 的安全校验应继续保留，未来实现可以复用，不能为另一 adapter 全局关闭。

## 9. 与 LiteLLM 的关系及待定项

LiteLLM native 是客户端支持的另一兼容协议，不是本草案逐接口的子集：它使用动态注册、自己的发现与账户响应，未提供相同应用 scopes，且只撤销提交的 refresh、默认 Access Token 更长。这些差异由 adapter 保留，不把期望写成上游事实。

定稿前需确认：scope 名及强制范围；Token 有效期与刷新家族保证；模型能力元数据；掉线、撤销失败和并发刷新恢复契约。实现顺序是先确认文档与服务端，再在独立 PR 中增加客户端新 adapter，最后由机构配置显式迁移。旧 OIDC 用户不会自动切协议。

规范依据：[OIDC Core / UserInfo](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo)、[OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)、[RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html)、[PKCE](https://www.rfc-editor.org/rfc/rfc7636.html)、[原生客户端](https://www.rfc-editor.org/rfc/rfc8252.html)、[动态注册](https://www.rfc-editor.org/rfc/rfc7591.html)、[Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707.html)、[撤销](https://www.rfc-editor.org/rfc/rfc7009.html)。
