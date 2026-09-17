# 架构与边界

**简体中文** | [English](architecture.en.md)

客户端以一个 Host 账户服务组合身份、Token 生命周期和 DSH 模型 Provider。服务端负责授权，客户端只消费明确声明的协议。

| 层次 | 职责 |
| --- | --- |
| Profile | 可信公开配置、完整发现地址、协议开关及品牌数据 |
| oidc.js / desktop-oidc.js | 共用身份验证、会话写入、浏览器和本机回调 |
| gateway-backend.js | Token 资源、并发刷新、授权隔离、退出及模型目录 |
| litellm-protocol.js / oidc-llm-protocol.js | 各协议的发现、注册与响应校验 |
| DSH Provider | 共用模型请求、JSON/SSE、附件和推理参数 |
| 机构扩展 | 通过共享 Host 传输处理本人配额等可选能力 |

OIDC 模式沿用严格 ID Token 验证器；LiteLLM native 的身份契约独立校验。两种模型接入均使用 Access Token，不存在 Key Binding 备用分支。oidc 配置只用于纯身份模式。

浏览器完成 Code + PKCE 后，Host 保存授权会话并加载获授权目录。调用前解析有效 Access Token；临近到期合并刷新。退出、重新授权或账户切换使旧调用失效。秘密由 Host 凭据服务保存，不进入 renderer 配置。

详情：[安全模型](security-model.md)、[Host 集成](dsh-integration.md)、[网关协议](gateway-auth/README.md)。
