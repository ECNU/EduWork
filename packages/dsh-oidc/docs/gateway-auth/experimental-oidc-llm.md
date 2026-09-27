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

组织登录建议显式选择 `identityMode: "oidc"`，与 EduWork@ECNU 当前配置一致。两种模式不自动互相降级：

| 模式 | 请求范围 | 身份验证 |
| --- | --- | --- |
| `oidc` | `openid profile offline_access llm:models:read llm:invoke`，并请求 consent | 首次必须有 RS256 ID Token；验证签名、issuer、aud/azp、nonce、时间、可选 at_hash 与 UserInfo sub |
| `oauth` | `llm:profile llm:models:read llm:invoke` | 从发现的 UserInfo 格式接口读取 sub；不宣称完成 OIDC 身份验证 |

目前仅实现预注册 public client，不能填写 client secret。服务器注册须允许 IPv4 loopback 回调 `http://127.0.0.1:<随机端口>/oauth/callback` 的实际端口变化，并约束 host/path。动态注册不属于当前接入要求。ChatECNU 的公开发现、端点和能力对照见[草案参考部署](oidc-llm-draft.md#8-chatecnu-参考部署)；公共示例保留中立域名，发行版自行提供地址和注册的 client ID。

发现声明 `authorization_response_iss_parameter_supported: true` 时，成功和错误授权回调都必须带 `iss`，且与发现中的 `issuer` 完全一致。缺失会报告 `gateway_callback_issuer_missing`；重复、空值或不匹配会报告 `gateway_callback_issuer_invalid`。客户端不会继续换取 Token，应由认证服务管理员核对发现声明与回调实现后重新发起登录。桌面回调监听在流程结束后关闭，刷新旧回调地址不能恢复登录。

`allowInsecureDevelopment` 是唯一的 HTTP 开关，放在企业对象中，与 `auth`/`oidc` 同级；默认 `false` 仅接受 HTTPS，改为 `true` 也接受 HTTP 服务地址。旧 `insecureDevelopmentOrigin` 已废弃并忽略。issuer 身份、资源同源关系及 OAuth/PKCE 校验仍按协议执行。`discoveryUrl` 填完整发现地址，`expectedIssuer` 可选，填写后必须与发现文档完全一致。

## 共享实现与边界

两套网关适配器共用发现请求、Code+PKCE、浏览器/回调、Host 凭据库、并发刷新合并、模型目录、DSH Provider 与流式请求隔离。OIDC 身份分支直接复用现有严格验证器；保留独立的纯身份 `oidc` 登录；旧模型 Key Binding 已移除，见[迁移说明](../key-binding-protocol.md)。

Access Token 按不透明 Bearer 处理。发现中的 `api_base` 与 UserInfo 必须和 resource 同源；认证端点只接收其角色对应的凭据，禁自动重定向。配置或发现绑定改变时不复用旧授权。Token 响应必须提供实际 scope、正整数有效期和 refresh token；scope 不得扩大或缺少本连接需要的权限。有效期按服务器响应执行，不规定 15 分钟上限；当前客户端校验范围为 1 秒至 365 天，不代表推荐寿命。

使用授权前，Host 在剩余有效期不超过 `min(30 分钟, 本次 Token 有效期的一半)` 时尝试刷新，并合并同一授权的并发刷新。这是客户端策略，不改变服务端的 Token 寿命。新 Token 不能替换已经发出的流式请求凭据；服务器是否允许长流跨越到期时刻仍需单独验收，模型生成不自动重放。

刷新可以省略 ID Token；返回时检查原 issuer、sub、aud、可选 auth_time 和 nonce。轮换后的 Token 若验证失败，客户端撤销新凭据并要求重登，避免继续使用可能已消费的旧 refresh token。临时 Token endpoint 故障不会删除仍有效的旧授权。

模型目录仍使用共享的保守能力映射：仅有 ID 时启用文本，不从名称猜图像或思考能力。草案中的可选模型能力扩展尚未消费，需要时使用显式审核的 provider 配置。

机构扩展可以调用既有 Host-only `modelResourceFetch(profileID, relativePath)`。模型连接统一使用当前获准的 Access Token，共享路径限制、GET、正文大小限制与退出隔离。公共插件不自动查询配额，也不新增配额 RPC 或字段。扩展须显式安装，服务端须自行声明并执行其授权范围。

退出清除本地授权、停止关联请求，再尝试撤销 Refresh Token；支持 200 空响应或 JSON。客户端接受已签发 Access Token 在服务端自然到期，不要求立即全局失效，也不退出浏览器中的组织 SSO。远端失败仅记录脱敏警告，当前没有持久化撤销重试队列。刷新家族重用检测与撤销范围、scope 隔离、模型过滤和长流到期行为需要服务端说明并验收。

参考：[OIDC 刷新响应](https://openid.net/specs/openid-connect-core-1_0.html#RefreshTokenResponse)、[授权响应 issuer](https://www.rfc-editor.org/rfc/rfc9207.html)。
