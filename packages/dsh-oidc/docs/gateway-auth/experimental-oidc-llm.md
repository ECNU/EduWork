# oidc-llm 实验接入

**简体中文** | [English](experimental-oidc-llm.en.md)

oidc-llm 0.1 的实验适配器已包含在 `@eduwork/dsh-oidc@0.3.0-dev.2` 与 EduWork `0.3.6-dev.20260921.1` 中，默认关闭，需显式启用。协议仍在讨论；本页描述已实现的客户端边界，不表示[完整草案](oidc-llm-draft.md)已经定稿或任意服务端均已通过验收。

## 配置

在桌面配置的 `organizations` 数组或插件的 `profiles` 中填写以下对象。服务器须明确发布完整的 `oidc_llm` 扩展；普通 OIDC 文档不会自动启用模型访问。

```json
{
  "schemaVersion": "dsh-oidc/v1alpha1",
  "id": "example-models",
  "displayName": "示例模型服务",
  "auth": {
    "discoveryUrl": "https://models.example.org/.well-known/openid-configuration",
    "expectedIssuer": "https://models.example.org",
    "experimentalOidcLlm": true,
    "clientId": "replace-with-public-client-id",
    "identityMode": "oidc"
  }
}
```

必须显式选择 `identityMode`。两种模式不自动互相降级：

| 模式 | 请求范围 | 身份验证 |
| --- | --- | --- |
| `oidc` | `openid profile offline_access llm:models:read llm:invoke`，并请求 consent | 首次必须有 RS256 ID Token；验证签名、issuer、aud/azp、nonce、时间、可选 at_hash 与 UserInfo sub |
| `oauth` | `llm:profile llm:models:read llm:invoke` | 从发现的 UserInfo 格式接口读取 sub；不宣称完成 OIDC 身份验证 |

目前仅实现预注册 public client，不能填写 client secret。服务器注册须允许实际 IPv4 loopback 回调 `http://127.0.0.1:<随机端口>/oauth/callback`。动态注册留待后续实现。

发现声明 `authorization_response_iss_parameter_supported: true` 时，成功和错误授权回调都必须带 `iss`，且与发现中的 `issuer` 完全一致。缺失会报告 `gateway_callback_issuer_missing`；重复、空值或不匹配会报告 `gateway_callback_issuer_invalid`。客户端不会继续换取 Token，应由认证服务管理员核对发现声明与回调实现后重新发起登录。桌面回调监听在流程结束后关闭，刷新旧回调地址不能恢复登录。

`allowInsecureDevelopment` 是唯一的 HTTP 开关，放在企业对象中，与 `auth`/`oidc` 同级；默认 `false` 仅接受 HTTPS，改为 `true` 也接受 HTTP 服务地址。旧 `insecureDevelopmentOrigin` 已废弃并忽略。issuer 身份、资源同源关系及 OAuth/PKCE 校验仍按协议执行。`discoveryUrl` 填完整发现地址，`expectedIssuer` 可选，填写后必须与发现文档完全一致。

## 共享实现与边界

两套网关适配器共用发现请求、Code+PKCE、浏览器/回调、Host 凭据库、并发刷新合并、模型目录、DSH Provider 与流式请求隔离。OIDC 身份分支直接复用现有严格验证器；保留独立的纯身份 `oidc` 登录；旧模型 Key Binding 已移除，见[迁移说明](../key-binding-protocol.md)。

Access Token 按不透明 Bearer 处理。发现中的 `api_base` 与 UserInfo 必须和 resource 同源；认证端点只接收其角色对应的凭据，禁自动重定向。配置或发现绑定改变时不复用旧授权。Token 响应必须提供实际 scope、正整数有效期和 refresh token；scope 不得扩大或缺少本连接需要的权限。有效期按服务器响应执行，不把尚未议定的 15 分钟建议写成硬性上限。

刷新可以省略 ID Token；返回时检查原 issuer、sub、aud、可选 auth_time 和 nonce。轮换后的 Token 若验证失败，客户端撤销新凭据并要求重登，避免继续使用可能已消费的旧 refresh token。临时 Token endpoint 故障不会删除仍有效的旧授权。

`/models` 条目的可选 `type` 用于区分模型用途，服务端未提供时由已审核的 `provider.models[].type` 补充。仅 `llm` 注册到对话，类型无法确定时不注册。输入模态与思考能力仍使用已审核的 Provider 配置，能看图的 LLM 不会被排除。详见 [Profile 说明](../enterprise-profile.md#provider-对象)。

机构扩展可以调用既有 Host-only `modelResourceFetch(profileID, relativePath)`。模型连接统一使用当前获准的 Access Token，共享路径限制、GET、正文大小限制与退出隔离。公共插件不自动查询配额，也不新增配额 RPC 或字段。扩展须显式安装，服务端须自行声明并执行其授权范围。

退出立即停止本机请求，再提交 refresh token 撤销；支持 200 空响应或 JSON。远端失败仅记录脱敏警告，当前没有持久化撤销重试队列，不能宣称满足草案中这项提议。服务器的 refresh 家族撤销、Access Token 剩余有效期、scope 隔离和模型过滤仍需真实验收。

参考：[OIDC 刷新响应](https://openid.net/specs/openid-connect-core-1_0.html#RefreshTokenResponse)、[授权响应 issuer](https://www.rfc-editor.org/rfc/rfc9207.html)。
