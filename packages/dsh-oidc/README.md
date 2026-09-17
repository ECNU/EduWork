# dsh-oidc

**简体中文** | [English](README_EN.md)

一次机构登录，直接使用获授权的模型。

当前源码提供 LiteLLM native OAuth 和显式启用的 oidc-llm 0.1 实验接入。两者共用浏览器/loopback、PKCE、Host 会话、刷新、退出与 DSH Provider；模型请求使用当前 Access Token，客户端不再申请或保存机构模型 API Key。个人 API Key 设置独立保留。

本分支尚未发布 npm 或桌面版本；已发布版本的行为以对应版本文档为准。旧 OIDC + Key Binding 配置在本源码中会被明确拒绝，迁移见[旧方案迁移](docs/key-binding-protocol.md)。服务端可继续保留旧接口供旧客户端使用。

## 开始接入

1. 根据服务端选择 [LiteLLM native OAuth](docs/gateway-auth/README.md) 或 [oidc-llm 实验接入](docs/gateway-auth/experimental-oidc-llm.md)。
2. 复制对应的[LiteLLM 示例](examples/litellm.enterprise-profile.example.json)或[OIDC Token 示例](examples/oidc-llm.enterprise-profile.example.json)，填写完整发现地址与所需公开配置。
3. 在桌面 Host 使用 backend: desktop，本机 Web 使用 backend: web。仅身份登录仍可使用[纯身份示例](examples/identity-only.example.json)；该模式不提供企业模型。
4. 登录后自动读取当前授权的模型目录。账户刷新不应覆盖用户后来选择的个人模型。

从源码验证：

~~~sh
cd packages/dsh-oidc
npm ci
npm run check
~~~

配置加载、Host 组合和服务端要求见[接入指南](docs/getting-started.md)。发行装配需使用经过审查、已发布并锁定的包；源码修改不会自动进入现有安装包。

## 功能与边界

- OIDC 模式验证 ID Token 签名、issuer、audience、nonce 与 UserInfo subject。LiteLLM native 按其自身契约处理，不猜测 Token 类型或降级协议。
- 请求前检查 Token 有效期；临近到期自动刷新，并发刷新合并为一次。
- 退出清理本地授权并取消在途模型请求，尽力撤销 Refresh Token。已签发 Access Token 的服务端有效期由服务端管理。
- 模型目录、JSON/SSE、推理档位和附件处理复用 DSH Provider。机构配额由[可选扩展](docs/account-extensions.md)通过共享 Host 传输读取。
- 品牌配置只接受受限数据，不加载远程代码。插件面向单机客户端，Web 仅监听本机。

进一步阅读：[Profile 配置](docs/enterprise-profile.md)、[桌面 Host](docs/desktop-host.md)、[架构](docs/architecture.md)、[安全边界](docs/security-model.md)、[开发](docs/development.md)。
