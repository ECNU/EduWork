# oidc-llm 0.1 协议草案

**简体中文** | [English](oidc-llm-draft.en.md)

**状态：已有实验实现的开放草案，尚未定稿，也不是 OpenID 官方标准。** 本文以 ChatECNU 已采用的接入方式和 EduWork 当前适配器为基础，定义可供其他模型平台实现的通用约定。公共客户端仍需显式启用，配置见[实验接入](experimental-oidc-llm.md)。[网关接入入口](README.md) · [服务端接入契约](../server-integration-contract.md)

## 1. 范围与接入流程

用户在系统浏览器登录组织账号，桌面公共客户端通过 Authorization Code + PKCE S256 取得 Token，直接用 Access Token 获取用户资料、模型目录并调用模型；无需再申请模型 API Key。其他符合本草案的客户端也可以接入，不依赖 EduWork 品牌或学校专属接口。

面向组织登录，建议采用完整 `oidc` 身份模式，这是 EduWork@ECNU 使用的方式；同时保留 `oauth` 基础模式。二者属于同一个模型接入协议，客户端明确选择，不能自动降级。仅验证身份的普通 OIDC 不会自动获得模型调用权限。

本草案不定义 Key Binding、配额、计费、团队管理或远程插件执行。机构能力通过独立插件扩展，不能把某个学校的模型名称、并发限制或配额字段写成公共协议要求。

## 2. 服务发现

客户端配置完整发现地址、可选的 `expectedIssuer` 和预注册的公共 `clientId`。发现请求不携带凭据，成功返回 200 JSON。下面的通用示例与 ChatECNU 当前声明的能力对应；域名和路径不是固定要求：

```json
{
  "issuer": "https://models.example.org",
  "authorization_endpoint": "https://models.example.org/oauth/authorize",
  "token_endpoint": "https://models.example.org/oauth/token",
  "userinfo_endpoint": "https://models.example.org/oauth/userinfo",
  "revocation_endpoint": "https://models.example.org/oauth/revoke",
  "jwks_uri": "https://models.example.org/oauth/jwks.json",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "scopes_supported": ["openid", "profile", "offline_access", "llm:profile", "llm:models:read", "llm:invoke"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],
  "authorization_response_iss_parameter_supported": true,
  "oidc_llm": {
    "version": "0.1",
    "resource": "https://models.example.org",
    "api_base": "https://models.example.org/open/api/v1",
    "identity_modes_supported": ["oauth", "oidc"],
    "client_registration_methods_supported": ["static"]
  }
}
```

`oidc_llm.version` 精确匹配 `0.1`；0.x 不承诺跨版本兼容。`resource` 只有一个，授权、换码与刷新请求均发送其原值。`api_base` 是模型 API 前缀，追加 `/models`、`/chat/completions`，不固定为 `/v1`。UserInfo 和 `api_base` 必须与 resource 同源；issuer 可以是独立登录域。这是本草案的资源约束，不是普通 OIDC 的通用要求。

当前适配器要求声明 `oauth` 基础模式；完整 OIDC 部署再声明 `oidc`、JWKS、支持的主体类型和 RS256。只部署 OAuth 模式时不要求 OIDC 签名元数据，但仍须提供 UserInfo、撤销、刷新、PKCE 和对应 scopes。两种模式都使用 `static` 注册与 `none` 客户端认证。

发现地址以 `/.well-known/openid-configuration` 结尾时，必须匹配 issuer 对应的标准位置。配置 `expectedIssuer` 时要求完全一致；未配置时，issuer 须与发现地址同源。生产端点使用 HTTPS；发现和携带凭据的请求不自动跟随重定向，浏览器导航除外。认证端点仅接收其角色对应的凭据。

保存的授权绑定协议、issuer、resource、client 和相关端点；配置或绑定改变要求重新授权。未知版本、同时声明 LiteLLM 与 oidc-llm、HTML 或缺失必要能力均应报错，不能换协议、关闭验签或转发旧 Token 绕过检查。

## 3. 客户端注册

当前接入方式是**静态预注册公共客户端**。组织为应用分配 client ID，用户各自授权；client ID 不是用户账号，也不是秘密。桌面端不保存共享 client secret。

服务端登记允许的回调 host/path。EduWork 使用 `http://127.0.0.1:<随机端口>/oauth/callback`，按 RFC 8252 允许 loopback 的实际端口变化；不能因此允许任意 host/path。换码必须使用本次授权的相同 redirect URI，刷新复用原 client ID。

动态客户端注册不属于当前 oidc-llm 接入要求，ChatECNU 的公开发现仅声明 `static`。未来如扩展动态注册，需要另行明确发现、注册权限和回调约束；不能照搬 LiteLLM 的动态注册流程并宣称已经兼容。

## 4. 授权、换码与身份

| 身份模式 | 本连接申请的 scopes | 身份验证 |
| --- | --- | --- |
| `oidc` | `openid profile offline_access llm:models:read llm:invoke` | 初次授权必须返回 ID Token，校验后核对 UserInfo |
| `oauth` | `llm:profile llm:models:read llm:invoke` | 读取 UserInfo 格式资料，不宣称完成 OIDC 身份验证 |

`llm:models:read` 授权读取本人可用模型，`llm:invoke` 授权调用；OAuth 模式的 `llm:profile` 用于本人资料。完整 OIDC 模式使用标准身份 scopes，不再额外请求 `llm:profile`。发现中即便存在 worker、会话、知识库或管理 scopes，客户端也不一并申请。服务端仍须执行实际用户权限。

浏览器授权携带 `response_type=code`、`client_id`、`redirect_uri`、随机 `state`、PKCE `code_challenge` / `S256`、`resource` 和 `scope`。OIDC 模式还发送随机 `nonce` 和 `prompt=consent`。用户拒绝时返回 `error=access_denied` 和原 state；无效 client/回调不得重定向到不可信地址。

成功回调包含 `code` 和原 state。发现声明 `authorization_response_iss_parameter_supported: true` 时，成功和错误回调都必须提供完全匹配的 `iss`。授权码须短期、单次使用，并绑定主体、client、redirect、PKCE、resource 和批准 scopes；具体有效期由服务端策略决定，本草案不固定 120 秒。

Token endpoint 接受 `application/x-www-form-urlencoded` POST：

| 操作 | 必须字段 |
| --- | --- |
| 换码 | `grant_type=authorization_code`、`client_id`、`code`、`redirect_uri`、`code_verifier`、`resource` |
| 刷新 | `grant_type=refresh_token`、`client_id`、`refresh_token`、`resource` |

完整 OIDC 模式的初次成功响应示例（Token 均为占位符，3600 秒仅为示例）：

```json
{
  "access_token": "OPAQUE_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "OPAQUE_REFRESH_TOKEN",
  "scope": "openid profile offline_access llm:models:read llm:invoke",
  "id_token": "SIGNED_ID_TOKEN"
}
```

响应应禁止缓存。Access Token 按不透明 Bearer 处理，不要求其为 JWT。`expires_in` 为正整数秒，以服务端响应为准，**不规定 15 分钟上限**；当前客户端另外拒绝超过 365 天的异常值，这不是推荐寿命。`scope` 必须明确返回本连接申请的权限集合，不能缺失、重复或额外扩大。OAuth 模式返回该模式的 scope，无需 ID Token。

OIDC 模式复用现有验证器，校验 RS256 签名、issuer、audience/azp、nonce、时间和存在时的 `at_hash`。初次缺少 ID Token 或验证失败即停止，不能退回 OAuth。刷新响应可省略 ID Token；返回时验证原主体、audience 及相关 claims，不能因刷新而更换身份。

## 5. UserInfo 与模型资源

客户端用同一 Access Token 请求发现中的 `userinfo_endpoint`，成功返回 200 JSON，例如：

```json
{
  "sub": "opaque-user-id",
  "name": "示例用户",
  "preferred_username": "example-user"
}
```

主体键为 issuer + sub，不能用姓名或邮箱代替。当前适配器要求 `sub` 为 1–255 个非空白可见 ASCII 字符；`name`、`preferred_username`、`picture`、`email` 为可选字符串，`email_verified` 为可选布尔值，缺少姓名或头像不使登录失败。完整 OIDC 的 UserInfo sub 必须与已验证 ID Token 一致，刷新后的 sub 也须保持不变。OAuth 模式不把这种资料读取称为 OIDC 身份验证。

| 资源 | 请求与响应 |
| --- | --- |
| `GET api_base + /models` | Bearer；200 OpenAI 风格 `{"object":"list","data":[{"id":"example-chat","object":"model"}]}`，只返回当前授权可用模型 |
| `POST api_base + /chat/completions` | 相同 Bearer；OpenAI-compatible 请求与普通 JSON 或 SSE 响应（`data:`，最终 `[DONE]`） |

服务端决定可用模型及额度，客户端不能用配置扩权。空目录保持为空；不同授权的资料、目录和请求隔离。仅有模型 ID 时，客户端按文本能力处理，不从名称猜测图像、思考或上下文上限；其他能力需显式配置或后续定义的元数据。

图像、音频和其他 API 由服务端与对应插件另行约定，不因“OpenAI-compatible”就假定全部支持。配额及学校服务仍属于机构扩展，不进入公共协议必选接口。

## 6. 刷新与长流式请求

刷新成功返回完整的新 Access Token / Refresh Token 对，主体和 resource 不变，scope 不扩大。客户端合并同一授权的并发刷新，并整体保存新凭据后再使用。Refresh Token 的有效期、轮换后的旧值处理、重用检测及家族撤销范围由服务端说明，不能从发现元数据推断。

EduWork 在使用授权前检查有效期，提前量为 `min(30 分钟, 本次 Token 有效期的一半)`。例如 2 小时 Token 剩余 30 分钟时触发，20 分钟 Token 剩余 10 分钟时触发。这是客户端请求前的刷新策略，不是服务端 Token 寿命，也不意味着应用关闭后仍后台续期。

临时网络故障、429 或 5xx 不应一概清空登录；客户端可继续使用尚未过期的 Token，过期则停止。明确的 `invalid_grant` / `invalid_client`、身份改变或收到无法安全接受的新凭据时要求重新登录。轮换响应丢失后的恢复策略仍需服务端明确，不能假设旧 Refresh Token 可以无限重试。

**新 Token 不能替换已经发出的 SSE 请求中的旧 Token。** 客户端刷新同一授权不会主动中断该请求；服务端是否允许已受理的长流跨越 Token 到期时刻，需要单独声明和验证。提前 30 分钟不构成无限时长保证。模型生成不由认证层自动重放，尤其不能在已输出内容后刷新重放，避免重复生成与计费。

## 7. 退出、撤销与错误

客户端退出立即停止本机授权使用，清除凭据及相关模型缓存，取消关联请求，再尽力撤销 Refresh Token。迟到的刷新、目录或流式结果不能恢复已退出的授权。该操作不等同于退出系统浏览器中的组织单点登录会话。

revocation endpoint 按 RFC 7009 接受 form `token`、公共 `client_id` 和 `token_type_hint=refresh_token`，成功 200，可为空响应或 JSON。撤销须阻止被撤销 Refresh Token 后续刷新；未知或已失效 Token 保持幂等。客户端接受已签发 Access Token 在服务端自然到期，不要求立即全局失效。撤销是否覆盖整个刷新家族，应由服务端明确，而非本草案假定。

撤销网络失败不阻止本地退出，客户端记录脱敏警告；目前没有跨重启的持久化撤销重试队列。不能把本机已退出等同于远端已经确认撤销。

OAuth 错误沿用 `invalid_request`、`invalid_client`、`invalid_grant`、`invalid_scope`、`unsupported_grant_type`，resource 不匹配使用 `invalid_target`。401 为认证失败，403 为权限不足，429 为限流，5xx 为服务异常；不能统一提示重新登录。安全读取可在 401 后刷新并重试一次，模型生成不自动重放。错误与日志不得泄露凭据。

## 8. ChatECNU 参考部署

ChatECNU 是采用本草案的参考部署，不是协议指定的唯一服务。其[公开发现文档](https://chat.ecnu.edu.cn/.well-known/openid-configuration)在 2026-09-25 声明：

| 项目 | 公开元数据 |
| --- | --- |
| issuer / resource | `https://chat.ecnu.edu.cn` |
| 模型 API 基址 | `https://chat.ecnu.edu.cn/open/api/v1` |
| 扩展版本 | `oidc_llm.version: "0.1"` |
| 身份模式 | `oauth`、`oidc`；EduWork@ECNU 显式选择 `oidc` |
| 客户端注册 | `static`，公共客户端认证方法 `none` |
| 授权与刷新 | Code、PKCE S256、Refresh Token |
| 身份验证 | RS256、公开 JWKS、UserInfo、授权回调 `iss` |

它还声明其他业务 scopes；本连接仅请求第 4 节所列权限。部署地址和公共 client ID 由发行版配置提供，不硬编码到公共插件。

发现文档能确认服务端声明的能力，不能证明 Token 的具体寿命、刷新家族重用检测、即时撤销效果、所有账号的模型过滤或长流到期行为。这些需要真实服务验收；不能把某次联调或客户端实现等同于服务端的完整保证。

## 9. 兼容与后续扩展

LiteLLM native OAuth 是另一条已支持的模型接入路线，使用自己的发现、动态注册及账户响应，不能视为本草案的逐接口子集。两套适配器共用凭据保存、刷新协调和模型请求隔离，各自保留协议差异。

后续讨论集中在动态注册、统一模型能力元数据，以及刷新响应丢失、Token 家族与长流式请求的服务端契约。当前接入按本文和[实验接入指南](experimental-oidc-llm.md)实现并验收，无需等待这些扩展才接入。已有机构迁移仍须显式修改配置并重新授权。

规范依据：[OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html)、[OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)、[PKCE](https://www.rfc-editor.org/rfc/rfc7636.html)、[原生客户端](https://www.rfc-editor.org/rfc/rfc8252.html)、[Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707.html)、[授权响应 issuer](https://www.rfc-editor.org/rfc/rfc9207.html)、[撤销](https://www.rfc-editor.org/rfc/rfc7009.html)。
