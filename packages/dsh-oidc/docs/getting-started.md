# 接入指南

**简体中文** | [English](getting-started.en.md)

新客户端的机构模型请求使用登录获得的 Access Token。先选择服务端实际提供的契约，再配置完整发现地址。

| 服务 | 示例 | 注册方式 |
| --- | --- | --- |
| LiteLLM native contract 1 | [LiteLLM](../examples/litellm.enterprise-profile.example.json) | 按契约动态注册 |
| oidc-llm 0.1 实验 | [OIDC Token](../examples/oidc-llm.enterprise-profile.example.json) | 预注册 public client，显式选择 oidc 或 oauth |
| 仅标准 OIDC 身份 | [纯身份](../examples/identity-only.example.json) | 预注册 public client，不提供企业模型 |

OIDC 模式需要浏览器登录、Code + PKCE、有效 ID Token 和 UserInfo。服务端必须明确授权该 Access Token 调用模型；仅填一个模型 URL 不会赋予权限。详见[服务端契约](server-integration-contract.md)。

## Host 配置

插件通过 config.profile、config.profiles 或 EDUWORK_OIDC_PROFILE 指向的可信 JSON 文件加载配置。桌面使用 backend: desktop，Host 提供凭据存储和 desktopServices.openExternal；插件监听临时 127.0.0.1 回调。本机 Web 使用 backend: web，WebServer 必须监听 127.0.0.1，回调端口取实际服务端口。

上述 Host 接入已发布于 `@eduwork/dsh-oidc@0.3.0-dev.2`；EduWork `0.3.6-dev.20260921.1` 已完成装配，桌面用户按 [LiteLLM 接入指南](gateway-auth/litellm-setup.md)编辑 `eduwork.jsonc` 即可。其他宿主应固定通过审查的包版本，不能把新配置直接交给不支持它的旧版本。从源码开发和验证见[开发说明](development.md)。

当前源码按模型 `type` 注册，仅 `llm` 进入对话。服务器只返回 ID 时，升级前须按实际模型 ID 补充 `provider.models[].type`；服务端类型优先，专用及类型未知的模型不进入对话。这项改动需要新插件/客户端与配置同步，尚不属于上述已发布版本。详见[模型说明](enterprise-profile.md)。

## 登录与使用

1. 用户在浏览器完成授权，客户端校验 state、PKCE 及适用的身份信息。
2. 登录后自动获取模型目录，使用同一授权连接 DSH Provider，不再要求创建模型 Key。
3. 临近到期时自动刷新，刷新后保留原身份和授权上下文。
4. 退出清理本地状态，停止使用旧授权。Token 的服务端寿命按部署策略执行。

配额继续由机构扩展提供，见[账户扩展](account-extensions.md)。旧配置请按[迁移说明](key-binding-protocol.md)改为 Token 接入。配置和日志不得包含密码、client secret 或用户 Token。
