# 服务端接入契约

**简体中文** | [English](server-integration-contract.en.md)

当前客户端消费两种显式网关契约。服务端发现声明与真实端点行为必须一致；客户端不会按品牌、URL 猜测 Token 含义，也不会自动退回旧模型 Key 流程。

- [LiteLLM native contract 1](gateway-auth/README.md)：动态注册、Code + PKCE、Token 模型调用、刷新与撤销。
- [oidc-llm 0.1 实验](gateway-auth/experimental-oidc-llm.md)：显式注册方式、身份模式、模型资源、公开 API 基址和作用域；仍为草案。
- [标准 OIDC 身份互操作](oidc-interoperability.md)：仅身份配置不提供模型资源。

## OIDC 模式要求

服务端提供匹配的 issuer、授权/Token/JWKS/UserInfo 端点，支持 public client 与 S256 PKCE。客户端验证 state、ID Token 签名和身份，再检查 UserInfo sub 一致性。发现声明支持授权响应 iss 时，回调也必须提供与 issuer 一致的值。

模型目录和调用接受相同获准 Access Token。API 地址和资源边界来自已验证的发现，服务端执行用户权限、模型访问与配额规则。模型目录采用 data[].id，调用复用 OpenAI-compatible JSON/SSE。

Token 响应提供有效期和刷新凭据；刷新不得改变已授权主体和上下文。客户端不要求退出后 Access Token 立即失效，退出时清理本地并尽力撤销 Refresh Token。

## 配额及兼容

公共包不定义统一配额、团队管理或 Key Binding 协议。机构可以通过[账户扩展](account-extensions.md)复用当前授权的 Host GET 传输及既有配额解析逻辑。

服务端可保留旧 Key Binding 端点服务老客户端。新客户端按[迁移说明](key-binding-protocol.md)使用 Token 直连，不调用旧取 Key 接口。[模型目录 OpenAPI](../protocol/resources.openapi.yaml)仅描述资源表面，不替代各网关认证契约。
