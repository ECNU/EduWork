# 机构接入参考

**简体中文** | [English](ecnu-reference.en.md)

公共包不包含真实机构地址、客户端注册信息、账号或配额数据。部署方可使用[OIDC Token 示例](../examples/oidc-llm.enterprise-profile.example.json)或[LiteLLM 示例](../examples/litellm.enterprise-profile.example.json)。

本人配额沿用机构服务端既有规则。可选机构扩展通过共享 Host 的 modelResourceFetch 发送当前 Access Token，并复用自己的解析器；公共包不定义配额对象或 RPC。

旧 Key Binding 配置迁移见[迁移说明](key-binding-protocol.md)。真实环境的联调日志和配置不进入公开仓库。
