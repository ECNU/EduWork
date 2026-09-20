# Token 模型资源接入

**简体中文** | [English](public-resource-protocol.en.md)

当前源码只通过获准 Access Token 接入机构模型。旧 Key Binding 的管理和模型 Key 流程已移除，详见[迁移说明](key-binding-protocol.md)。

| 操作 | 地址来源 | 使用凭据 |
| --- | --- | --- |
| 模型目录 GET /models | 已验证网关发现的 API 基址 | 当前 Access Token |
| 模型 JSON/SSE 调用 | 相同 API 基址 | 当前 Access Token |
| 可选机构配额 GET | 机构扩展声明的相对路径 | 共享 Host 传输中的当前 Access Token |

目录响应中的 data[].id 决定可见模型；本地元数据可以补充上下文、模态和推理事实，不能扩大服务端授权。退出或重新授权会取消在途调用，并拒绝旧调用使用新账户凭据。同一授权正常刷新可以继续工作。

公共 Remote 只返回模型资源投影，不包含 Token、配额或管理接口。配额逻辑和授权范围由机构维护，见[账户扩展](account-extensions.md)。[目录 OpenAPI](../protocol/resources.openapi.yaml)与[网关契约](gateway-auth/README.md)共同说明接入表面。
