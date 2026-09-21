# 旧 Key Binding 接入迁移

**简体中文** | [English](key-binding-protocol.en.md)

当前客户端源码已移除 Key Binding 模型凭据流程：不再调用 /bootstrap 或 /runtime-credential 的 provision、resolve、renew，也不再接受 keyBinding 配置或 backend: native 旧账户桥。

服务端可以继续实现旧接口，供已发布的老客户端使用。新客户端的机构模型接入统一使用 Access Token；兼容责任不要求新客户端保留旧取 Key 分支。

## 迁移步骤

1. 确认服务端已支持 [oidc-llm 实验契约](gateway-auth/experimental-oidc-llm.md)，或使用 [LiteLLM native 契约](gateway-auth/README.md)。
2. 把旧 oidc + keyBinding + provider.baseURL 配置替换为完整 auth.discoveryUrl；OIDC 模式另外填写显式实验开关、预注册 public client ID 和 identityMode。
3. 保留稳定的 Profile/Provider ID 和模型能力元数据，但模型可见性、API 基址来自已验证的发现和目录。
4. 重新登录。客户端不猜测旧服务的新发现地址，不把旧模型 Key 当作 Access Token，也不自动回退。旧本地凭据不会被新模型路径读取；不批量删除可能仍由其他配置使用的 Key。
5. 仅身份登录可继续使用 oidc 配置，但不得同时配置模型 provider。

这项配置变更已包含在 `@eduwork/dsh-oidc@0.3.0-dev.2` 和 EduWork `0.3.6-dev.20260921.1` 中；旧协议细节以历史版本为准。个人 API Key 入口保持可用。
