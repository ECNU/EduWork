# 机构认证升级

**简体中文** | [English](EDUWORK-MIGRATION.en.md)

当前源码用 Token 网关授权替代 Key Binding 模型接入。旧模型配置会被拒绝，需显式迁移配置并重新登录。工作区、会话和个人 Provider 设置不变；旧模型 Key 不会被新路径接纳，也不会被批量删除。使用 desktop/web Host 服务，旧 native 账户桥已移除。

见[迁移步骤](key-binding-protocol.md)、[配置](enterprise-profile.md)与[兼容性说明](compatibility.md)。
