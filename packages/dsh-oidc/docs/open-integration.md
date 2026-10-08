# 开放身份与模型接入

**简体中文** | [English](open-integration.en.md)

机构用户可以通过一次浏览器授权，在通用客户端使用自己的模型访问权限。OIDC 负责身份验证；模型服务明确授予 Access Token 模型权限，客户端复用发现、PKCE、刷新和模型 Provider。

模型接入有两条路线：[oidc-llm 实验草案](gateway-auth/experimental-oidc-llm.md)与 [LiteLLM native OAuth](gateway-auth/litellm-setup.md)。oidc-llm 是我们面向机构与多客户端互通推进的开放协议方向，ChatECNU 已采用这条路线；LiteLLM 适配则直接兼容现有网关的原生授权契约。

oidc-llm 0.1 仍需评审，实验实现不等于标准定稿，也不是 OpenID 官方标准。完整提议见[协议草案](gateway-auth/oidc-llm-draft.md)，已实现范围以实验接入说明为准。草案中的 `oidc` / `oauth` 是身份模式；另行保留的纯身份 OIDC 登录不提供模型访问，不是第三条模型接入路线。个人模型仍可独立配置。

新客户端不再消费 Key Binding。服务端可同时支持新 Token 模型接入和老客户端接口；新客户端无需保留旧实现。机构配额、团队策略、网页和运维功能由机构独立扩展，公共包提供受控 Host 传输。

参与接入请先阅读[服务端契约](server-integration-contract.md)、[配置](enterprise-profile.md)与[开发指南](development.md)。
