# Worker User Center Key Binding Protocol v1

**简体中文** | [English](key-binding-protocol.en.md)

## 1. 状态与术语

本文定义 `worker-user-center-v1`：`dsh-oidc` 用它把经 OIDC 认证的 subject 与模型运行时 API Key 绑定。这是企业管理协议，不属于 OIDC 标准。

它是[服务端接口规范](server-integration-contract.md)中托管模型能力档的组成部分，需与 OIDC Provider 和模型网关共同实现。纯身份 Profile 不要求 Key Binding。

关键词 **必须（MUST）**、**不得（MUST NOT）**、**必需（REQUIRED）**、**应该（SHOULD）**、**不应该（SHOULD NOT）**、**建议（RECOMMENDED）**、**不建议（NOT RECOMMENDED）**、**可以（MAY）** 和 **可选（OPTIONAL）** 按 RFC 2119 与 RFC 8174 解释。

[`protocol/openapi.yaml`](../protocol/openapi.yaml) 是配套的机器可读契约。若正文与 OpenAPI 不一致，本文决定安全和生命周期语义，OpenAPI 决定字段拼写和基本结构。任何差异都属于规范缺陷，必须报告。

## 2. 设计目标

协议区分三类凭据：

- 机构密码：只由 OIDC Provider 看见；
- OIDC access token：只用于 UserInfo 和 Key Binding 服务；
- 模型运行时 API Key：只用于模型 Provider 路由。

API Key 是可替换、可撤销的运行凭据，不是用户身份证明。Key Binding 服务端是决定其创建和解析权限的授权权威。

## 3. Base URL 与固定资源

Enterprise Profile 提供一个 HTTPS `keyBinding.baseURL`。其中不得包含 userinfo、query 或 fragment，并且应该包含类似 `/api/worker/v1` 的版本路径。

相对于该 base URL，以下路径固定不变：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/bootstrap` | 读取 Provider、能力、授权资格和凭据状态。 |
| POST | `/runtime-credential/provision` | 状态为 `missing` 时创建或绑定凭据。 |
| POST | `/runtime-credential/resolve` | 返回活动凭据。 |
| POST | `/runtime-credential/renew` | 轮换 `expiring` 或 `expired` 凭据。 |

Profile 和用户不得覆盖路径、HTTP 方法、字段映射或凭据引用名。

## 4. 认证与授权

除显式 loopback 开发环境外，每个请求都必须使用 TLS。客户端发送：

```http
Authorization: Bearer <OIDC access token>
Accept: application/json
```

服务端至少必须验证：

- token 签名或 introspection 结果；
- issuer；
- 面向 Key Binding 服务的 audience；
- 过期时间和 not-before；
- 已认证 subject；
- 操作所需 scope；
- 机构成员资格、账号状态和模型授权。

建议 scope：

| 操作 | Scope |
| --- | --- |
| bootstrap | `worker.bootstrap.read` |
| provision | `worker.credential.provision` |
| resolve | `worker.credential.read` |
| renew | `worker.credential.renew` |

部署可以使用不同 scope 名称，但这些仍属于 OIDC 授权策略，并列在 Enterprise Profile `oidc.scopes` 中；网络操作本身不变。

服务端必须从已验证 access token 派生绑定 subject，不得接受请求 body 中由调用方提供的 subject ID。

## 5. Bootstrap

请求：

```http
GET /api/worker/v1/bootstrap HTTP/1.1
Authorization: Bearer …
Accept: application/json
```

最小成功响应：

```json
{
  "provider": { "id": "example-ai" },
  "capabilities": ["worker.credential.provision"],
  "runtime_credential": {
    "status": "missing",
    "provisioning": { "allowed": true }
  }
}
```

返回的 `provider.id` 是必需字段，必须与 Enterprise Profile `provider.id` 完全相等。不一致即视为绑定失败。

有效的 `runtime_credential.status`：

- `missing`：尚未绑定凭据；
- `active`：可以解析活动凭据；
- `expiring`：存在 `api_key_id` 时轮换，否则按服务端策略解析；
- `expired`：存在 `api_key_id` 时轮换，否则按服务端策略解析；
- `suspended`：授权或账号已停用；本地凭据不得继续视为可用；
- `unavailable`：服务当前无法提供凭据。

`subject` 可以携带仅供管理面显示的信息。客户端不得用它替换 OIDC `sub` 或 `name`。

若返回 `protocol_version`，其值必须是 `worker.user-center.v1`、`worker-user-center/v1` 或 `eduwork-resources/v1`（三个别名共享同一组 v1 字段与路径，未知版本拒绝）。该字段在 v1 采用阶段可选；未来 major 协议可以要求显式协商。

## 6. Provision

用户必须先完成 OIDC 认证。`dsh-oidc` 还要求显式 UI 操作（`allowProvision: true`），因此仅完成 callback 不会静默创建模型凭据。

```http
POST /api/worker/v1/runtime-credential/provision HTTP/1.1
Authorization: Bearer …
Content-Type: application/json
Idempotency-Key: <UUID>

{ "provider_id": "example-ai" }
```

服务端必须：

- 验证该 subject 获准使用 `provider_id`；
- 执行机构凭据创建策略；
- 对相同已认证 subject、Provider 和 Idempotency-Key 保证幂等；
- 在服务端幂等保留窗口内，对重放请求返回相同逻辑结果；
- 同一 key 与不同 payload 重用时返回 `409 Conflict`；
- 绝不记录返回的 API Key。

## 7. Resolve

```http
POST /api/worker/v1/runtime-credential/resolve HTTP/1.1
Authorization: Bearer …
Content-Type: application/json

{
  "provider_id": "example-ai",
  "api_key_id": "optional-known-id"
}
```

Resolve 不得创建新的授权资格。它返回已绑定到 subject 的活动凭据，或者返回 `404`/策略错误。服务端可以在保持同一逻辑 `api_key_id` 的情况下轮换不透明秘密材料，但不得改变 Provider 所有权。

## 8. Renew

```http
POST /api/worker/v1/runtime-credential/renew HTTP/1.1
Authorization: Bearer …
Content-Type: application/json
Idempotency-Key: <UUID>

{
  "provider_id": "example-ai",
  "api_key_id": "key-123"
}
```

Renew 要求提供 `api_key_id`，必须幂等，并轮换或替换即将过期/已过期凭据。服务端应该在操作安全允许后尽快使旧秘密材料失效，并且必须记录任何重叠有效窗口。

## 9. 凭据响应

三个 POST 操作成功时都返回：

```json
{
  "provider_id": "example-ai",
  "api_key": "secret-runtime-value",
  "api_key_id": "key-123",
  "status": "active",
  "expires_at": "2026-09-01T00:00:00Z"
}
```

`provider_id`、`api_key` 和 `status=active` 是必需字段。Provider 缺失、不匹配或 key 为空时，客户端会拒绝响应。

凭据响应必须包含 `Cache-Control: no-store`，并且应该包含 `Pragma: no-cache`。服务端、代理、APM agent 和 WAF 必须脱敏 Authorization header 与 `api_key` 响应字段。不得把秘密写入 URL、错误详情、分析事件或审计日志。

## 10. 错误

错误应该遵循 RFC 9457，使用 `application/problem+json`，并提供稳定扩展字段 `code`。至少包含：

- `400`：请求或 Provider ID 格式错误；
- `401`：token 缺失、无效、过期或 audience 错误；
- `403`：scope、成员资格、授权、停用或创建策略拒绝；
- `404`：没有可解析或可更新的凭据；
- `409`：幂等或生命周期冲突；
- `429`：限流，最好包含 `Retry-After`；
- `5xx`：不包含秘密材料的服务端失败。

同一逻辑操作重试 provision/renew 时，客户端必须保留相同 Idempotency-Key。`dsh-oidc` 当前只发起一次调用；DSH 模型请求重试属于另一条链路，绝不会重复 Key Binding 操作。

## 11. 生命周期与撤销

以下情况发生时，Key Binding 服务应该撤销模型凭据：

- 机构成员资格或授权终止；
- OIDC subject 被停用；
- 凭据被轮换；
- 安全管理员撤销凭据；
- 达到最大生命周期。

本地退出会删除缓存模型 Key，但不能单独证明远程凭据已撤销。要求即时远程撤销的部署，应该在未来协议版本增加经过认证的管理操作，而不是复用 OIDC token revocation。

模型网关必须独立执行 API Key 状态、Provider scope、过期和配额策略。持有旧 Key 不得无限期绕过当前企业策略。

## 12. 隐私与审计

服务端应该尽量减少 bootstrap 返回的身份数据。审计记录应该包含事件时间、不透明 subject 引用、Provider ID、操作、结果、策略原因、请求关联 ID 和 `api_key_id`，绝不能包含 API Key 或 OIDC token。

数据保留、访问控制、泄露响应和跨境处理由部署方负责。该协议不授予收集更多个人数据的权限。

## 13. 符合性检查

服务端满足以下条件时符合本规范：

- 实现全部四个固定资源；
- 使用 OIDC access token 认证请求，绝不使用请求 body 中的 subject 数据；
- 返回完全匹配的 Provider 绑定；
- 执行所需 scope 和机构授权；
- 实现 provision/renew 幂等；
- 凭据响应使用 no-store；
- 不记录秘密；
- 提供稳定生命周期状态和问题代码；
- 通过仓库 OpenAPI 契约测试和机构特有授权测试。
