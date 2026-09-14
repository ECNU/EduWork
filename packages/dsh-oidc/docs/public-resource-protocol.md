# EduWork 公共身份与资源协议 v1

**简体中文** | [English](public-resource-protocol.en.md)

本规范属于通用 `@eduwork/dsh-oidc`。身份登录、自动获得模型 Key 和自动配置模型由本包实现；配额由独立机构扩展实现，公版既不请求也不展示配额；远端语音、机构活跃心跳和校内服务由独立插件实现。所有客户端均为单机，Web 只是本机 Runtime 的界面。

## 接入模式

- 纯身份接入：只配置 `oidc`，省略 `keyBinding` 与 `provider`。登录成功即完成身份接入。用户继续在 DSH 原生模型设置添加自己的 API Key，退出机构身份不会删除个人凭据。见 [示例](../examples/identity-only.example.json)。
- 完整资源接入：同时配置 `keyBinding` 与 `provider`。`keyBinding.type` 默认为 `worker-user-center-v1`；也可显式声明 `eduwork-resources-v1`。两者复用同一组已部署的固定路径，不要求现有机构改造端点。见 [自动目录示例](../examples/resources-discovery.example.json)。

这两个模式都允许其他模型与个人 API Key，不能以组织登录覆盖原生模型配置。可选 `brand` 只负责展示，空品牌保持宿主产品名称。

## 路径与认证

| 能力 | 路径 | 凭据 |
| --- | --- | --- |
| 身份 | OIDC Discovery、Authorization Code + PKCE S256、Token、JWKS、UserInfo | OIDC 标准 |
| 凭据状态 | `GET {keyBinding.baseURL}/bootstrap` | OIDC Access Token |
| 申请、读取、续期 Key | `POST {keyBinding.baseURL}/runtime-credential/{provision,resolve,renew}` | OIDC Access Token |
| 模型目录 | `GET {provider.baseURL}/models` | 获得的模型 API Key |
| 模型调用 | `POST {provider.baseURL}/chat/completions` | 获得的模型 API Key |

管理面既有字段、幂等语义见 [Key Binding OpenAPI](../protocol/openapi.yaml)。完整扩展见 [资源 OpenAPI](../protocol/resources.openapi.yaml)。Bootstrap 的可选 `protocol_version` 接受 `worker.user-center.v1`、`worker-user-center/v1` 或 `eduwork-resources/v1`；未知版本拒绝。主体身份只来自经验证的 OIDC，Bootstrap 不覆盖用户身份、发行配置、执行模块或服务地址。资源请求不跟随重定向。

## 模型目录

`provider.modelSource` 默认 `profile`，使用发行方已审查的模型事实，保证现有部署不受发现接口变化影响。设为 `discovery` 时登录/凭据关联后自动读取 `/models`；`models` 可省略，初始化时等待目录，不注册伪造的模型。

`/models` 返回 `{"data":[{"id":"model-a"}]}`，最多 128 个不同 ID。目录内已在 Profile 声明的 ID 沿用其 reasoning、模态和上下文等事实；其他新 ID 仅声明文本与不支持推理档位。不能从模型名猜能力，也不采用服务响应中的执行配置或任意 URL。目录为空、结构错误或暂不可用时保留上一份已可用目录，并单独返回 `models_unavailable`。

成功更新目录会替换同一 Provider 的运行模型快照，新调用使用新目录，已经准备的调用继续使用原快照。重启后首次读取已登录状态会重新发现。个人提供方不受影响。

## 宿主 RPC 与装配

插件名为 `@eduwork/dsh-oidc`，Bundle 层 ID 为 `enterprise-oidc`。`backend: web`、`uiMode: standard` 启用公共界面；`external` 允许产品自绘入口但保留公共 RPC。`allowEmptyProfiles: true` 允许公版先只用个人 Key。

环境变量 `EDUWORK_OIDC_PROFILE` 指向一个 Profile、Profile 数组或 `{ "profiles": [...] }` 文件。未设置时兼容 `DSH_OIDC_ENTERPRISE_PROFILE`；显式 `profilePathEnv` 仍遵循宿主指定名称。

`oidcAccounts.configuration/status/begin/reconcile/logout/management` 保持原契约；新增 `resources(profileID)` 返回 `{profileID, modelSource, models, issues}`，不含秘密。`reconcile` 自动同步模型元数据。旧 `native` backend 不调用原配额桥接口，不新增桌面框架依赖；新桌面 `backend: desktop` 与 Web 共享 OIDC 实现，使用临时 loopback 回调而不依赖常驻 WebServer。

专属插件可在 Host 调用 `ctx.oidcAccounts.authorizedFetch(profileID, endpoint, init)`，复用有效 OIDC Access Token、刷新及一次 401 重试，得到普通 `Response`。此方法没有 Remote 标记，不向浏览器暴露 Token；默认只允许该 Profile 的 issuer 和 Key Binding 精确 origin。额外 HTTPS origin 必须通过受信宿主插件配置 `authorizedOrigins` 声明，浏览器不能改变。并发请求共享一次 Refresh Token 轮换，避免心跳与模型配置同时刷新造成失效。该入口提供认证运输能力，不定义心跳或语音业务。

Host 事件 `oidc/accounts-changed` 返回 `{profileID, state}`。`authenticated` 与 `connected` 都表示身份已登录，纯身份的 `connected` 不要求模型 Key；`signed_out` 表示已退出。未登录的授权请求抛出 `oidc_login_required`，越界 origin 为 `oidc_authorized_origin_denied`；第二次 HTTP 401 仍返回 Response，由业务方处理。主动退出不应自动弹出过期提示。

Issuer、Client ID 或资源端点变化会阻止旧管理凭据流向新环境；旧 Web 登录记录仍可复用身份，但需要重新关联模型 Key。个人 API Key 不受机构注销与资源绑定变化影响。



机构账户扩展使用 [Host 授权传输与账户菜单插槽](account-extensions.md)。声明 capability 不会激活扩展；发行方必须显式安装和配置机构插件。
