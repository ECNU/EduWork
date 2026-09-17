# 开放身份与模型接入

**简体中文** | [English](open-integration.en.md)

机构用户可以通过一次浏览器授权，在通用客户端使用自己的模型访问权限。OIDC 负责身份验证；模型服务明确授予 Access Token 模型权限，客户端复用发现、PKCE、刷新和模型 Provider。

当前实现支持 [LiteLLM native OAuth](gateway-auth/README.md) 与 [oidc-llm 实验草案](gateway-auth/experimental-oidc-llm.md)。草案仍需评审，已实现不等于标准定稿。个人模型和纯身份登录保留独立入口。

新客户端不再消费 Key Binding。服务端可同时支持新 Token 模型接入和老客户端接口；新客户端无需保留旧实现。机构配额、团队策略、网页和运维功能由机构独立扩展，公共包提供受控 Host 传输。

参与接入请先阅读[服务端契约](server-integration-contract.md)、[配置](enterprise-profile.md)与[开发指南](development.md)。
