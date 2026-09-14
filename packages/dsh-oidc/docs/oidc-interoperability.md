# OIDC 互操作规范

**简体中文** | [English](oidc-interoperability.en.md)

OIDC 是[服务端接口规范](server-integration-contract.md)的身份能力档，纯身份 Profile 可只实现本文件。只有需要托管模型 Key 和自动配置企业模型时，才必须同时提供 Key Binding 和模型网关。

## 标准依据

Web 后端是基于以下标准的 public OpenID Connect Relying Party：

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [OAuth 2.0 Authorization Framework（RFC 6749）](https://www.rfc-editor.org/rfc/rfc6749)
- [PKCE（RFC 7636）](https://www.rfc-editor.org/rfc/rfc7636)
- [OAuth 2.0 for Native Apps（RFC 8252）](https://www.rfc-editor.org/rfc/rfc8252)
- [OAuth 2.0 Token Revocation（RFC 7009）](https://www.rfc-editor.org/rfc/rfc7009)
- [OAuth 2.0 Authorization Server Issuer Identification（RFC 9207）](https://www.rfc-editor.org/rfc/rfc9207)

本文说明 `dsh-oidc` 在这些标准范围内采用的更严格互操作选择。

## Provider 必需行为

Provider 必须：

1. 在 `{去掉末尾斜杠的 issuer}/.well-known/openid-configuration` 发布 Discovery；
2. 返回与配置的 Issuer Identifier 完全一致的 `issuer`；
3. 发布 `authorization_endpoint`、`token_endpoint`、`jwks_uri` 和 `userinfo_endpoint`；
4. 在 `code_challenge_methods_supported` 中声明 `S256`；
5. 签发带非空 `kid` 的 RS256 ID Token，并提供唯一匹配的 RSA 签名 JWK；
6. 支持无 client secret 的 public client Authorization Code flow；
7. 从 token endpoint 返回 Bearer access token 和 ID Token；
8. 返回 JSON UserInfo，其中非空 `sub` 必须与 ID Token `sub` 相同。

标准允许 Discovery endpoint 使用与 issuer 不同的 HTTPS origin。插件拒绝网络 HTTP；只有 Profile 显式启用开发模式，且 issuer/endpoint 主机都是 loopback 时才接受 HTTP。

当前实现只支持 RS256。使用 ES256、PS256、加密 ID Token、签名 UserInfo JWT、PAR、JAR、DPoP 或 mTLS 的 Provider 暂不兼容。

## Authorization 请求

插件生成密码学安全随机值：

- 256-bit `state`；
- 256-bit `nonce`；
- 384-bit PKCE verifier 和 S256 challenge。

待完成流程十分钟后过期，每个插件进程最多保存 32 个。Discovery 返回的 authorization endpoint 上已有 query 参数会被保留，协议参数则由插件设置。

Redirect URI 始终为 `http://127.0.0.1:<DSH端口>/oauth/callback`。host 和 path 固定，端口取 DSH WebServer 的实际监听端口；不从请求头或代理配置推断。

## Callback 校验

Callback：

- 只接受固定路径；
- 成功响应必须恰好包含一个非空 `state` 和一个非空 `code`；
- 拒绝重复的 `state`、`code`、`error` 或 `iss` 参数；
- 即使失败，也只允许一个待处理 state 被消费一次；
- 如果存在 RFC 9207 `iss`，则对其进行校验；
- 使用原始 PKCE verifier 交换 code。

Callback 后的 `returnPath` 必须是同源绝对路径，以防止开放重定向。

## ID Token 校验

实现会校验：

- 三段式 JWS 结构；
- protected header 中 `alg=RS256` 且 `kid` 非空；
- 恰好一个 RSA JWK 与 `kid` 匹配，可选 `use=sig` 和 `alg=RS256`；
- 签名；
- `iss` 完全一致；
- `aud` 包含 client ID；
- 当 `aud` 有多个值时，`azp` 等于 client ID；
- 非空 `sub`；
- nonce 完全一致；
- 必需且有限的 `iat`、`exp`，以及可选 `nbf`，允许 60 秒时钟偏差；
- 存在 `at_hash` 时校验它。

TLS 信任和 DNS 解析仍由 Node.js 宿主和操作系统负责。

## UserInfo 与显示身份

虽然并非所有通用 OIDC 部署都强制发布 `userinfo_endpoint`，本互操作规范要求它存在。

响应必须包含 `sub`，且必须与已验证 ID Token 的 `sub` 匹配。账号显示名称按以下顺序确定：

1. 非空且去除首尾空白的标准 UserInfo `name`；
2. 否则使用去除首尾空白的 UserInfo `sub`。

插件有意不提供 JSON path 映射或私有人员信息 endpoint。希望显示人类可读姓名的机构，应该修正 OIDC UserInfo 响应并提供标准 `name` claim。

当前接受 `affiliation` 作为可选显示扩展，但它不影响授权。未来稳定规范可能将其替换为带命名空间的 claim，或直接移除。

## 刷新与退出

当 access token 距离过期不足 90 秒且存在 refresh token 时，插件会刷新会话。若收到 `invalid_grant`，会删除已存 OIDC 会话和本地模型凭据，并要求重新登录。轮换后的 refresh token 会替换旧值。没有 refresh token 的过期会话在下次需要活动会话时按同样方式处理。

退出登录时，如果 Discovery 发布 `revocation_endpoint`，插件会尝试按 RFC 7009 撤销 token；随后在本地删除该 Profile 的 OIDC 会话与归属于它的托管模型凭据；共享引用已被其他登录改写时不会删除另一方的 Key。远程撤销失败会被记录，但不阻止本地清理。

当前版本不实现 RP-Initiated Logout、front-channel logout 或 back-channel logout。
