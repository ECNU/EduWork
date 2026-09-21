# LiteLLM 接入指南

**简体中文** | [English](litellm-setup.en.md)

让用户在 EduWork 中登录 LiteLLM 网关，自动发现获授权的模型并直接对话，无需手动分发模型 API Key。

[LiteLLM 项目](https://github.com/BerriAI/litellm)提供网关；EduWork 使用其 native OAuth 流程。本文适用于已有 LiteLLM 部署的管理员和使用 EduWork 桌面的用户。协议基线为 **LiteLLM v1.101.0 / native contract 1**，其他版本需按本文验收。**EduWork 0.3.6-dev.20260921.1 已内置本功能**，安装包附带 `examples/litellm.jsonc`，无需另装插件。底层实现已发布为 `@eduwork/dsh-oidc@0.3.0-dev.2`。

## 1. 管理员准备服务端

先按 [LiteLLM 官方部署说明](https://docs.litellm.ai/docs/proxy/quick_start)准备网关、数据库和至少一个可用的真实模型上游。为测试用户配置账号、团队与模型权限，并确认该账号能登录网关网页。企业 SSO 的部署和授权要求以 LiteLLM 为准；本指南不要求新增身份提供商。

在已有 LiteLLM Proxy 进程或容器中设置以下环境变量，然后重启服务。将示例域名换成用户实际访问的 HTTPS 地址：

```dotenv
PROXY_BASE_URL=https://gateway.example.org
EXPERIMENTAL_UI_LOGIN=True
```

`PROXY_BASE_URL` 决定公开发现地址中的 issuer 与端点；反向代理后的内网地址不能冒充公开地址。`EXPERIMENTAL_UI_LOGIN` 启用该版本要求的登录功能。配置依据见 [LiteLLM CLI Authentication](https://docs.litellm.ai/docs/proxy/cli_sso)。

代理需转发发现、授权、注册、换码、撤销和模型路由，保留查询参数与表单请求体，并允许模型 SSE 持续输出。不要将认证 POST 重定向到另一域名。多 worker / 副本需共享 Redis；可按官方说明配置 `general_settings.coordination_redis`，避免刷新轮换或撤销只在某个进程生效。参见 [LiteLLM 配置参考](https://docs.litellm.ai/docs/proxy/config_settings)和[原生认证实现](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/proxy/_experimental/mcp_server/discoverable_endpoints.py)。

从用户所在网络检查公开发现入口，无需登录或附带 Token：

```sh
curl --fail --silent --show-error https://gateway.example.org/.well-known/litellm-cli-auth
```

应返回 JSON，满足：

- `contract_version` 为 `1`，`issuer` 和 `resource` 都是管理员配置的公开网关地址。
- 包含 `authorization_endpoint`、`token_endpoint`、`registration_endpoint` 和 `revocation_endpoint`。
- 声明授权码、刷新、PKCE `S256` 和 public client 的 `none` 认证能力。

完整发现响应及字段约束见[协议参考](README.md)。EduWork 会检查发现文档，拒绝缺失能力或端点绑定不一致的服务；仅能访问登录页不代表接入完成。

## 2. 配置 EduWork

在设置中选择 **打开配置文件**，将下面 `organizations` 数组内的机构对象加入生效 `eduwork.jsonc` 的同名数组。Windows 文件在程序目录的 `config/`，macOS 公版在 `~/Library/Application Support/eduwork-electron/config/`；旁边 `examples/litellm.jsonc` 提供相同格式和完整注释。只修改示例不会生效，也不要用整个示例覆盖已有配置。

```json
{
  "schemaVersion": 1,
  "organizations": [
    {
      "schemaVersion": "dsh-oidc/v1alpha1",
      "id": "example-gateway",
      "displayName": "示例模型网关",
      "allowInsecureDevelopment": false,
      "auth": {
        "discoveryUrl": "https://gateway.example.org/.well-known/litellm-cli-auth",
        "expectedIssuer": "https://gateway.example.org"
      }
    }
  ]
}
```

| 字段 | 如何填写 |
| --- | --- |
| `id` | 本机唯一且稳定的机构标识；多个机构使用不同值。 |
| `displayName` | 账户菜单中显示的机构名称。 |
| `allowInsecureDevelopment` | 默认 `false`，仅接受 HTTPS；HTTP 测试环境设为 `true`，与 `auth` 同级。 |
| `auth.discoveryUrl` | 完整发现文档 URL，由管理员提供。 |
| `auth.expectedIssuer` | 预期的服务签发方，建议填写，并与发现文档中的 issuer 一致。 |

保存后从托盘或应用菜单完全退出 EduWork，再重新启动。只关闭窗口通常不会退出进程。

模型 API 地址由校验后的 issuer 追加 `/v1` 得到，保留部署路径前缀；不要另填 `provider.baseURL`。LiteLLM 会动态注册本次登录所需的 Client ID，无需手工填写固定 `clientId`、`client_secret` 或 scope，也不要同时配置 `oidc`、`keyBinding`。

`allowInsecureDevelopment` 是唯一的 HTTP 开关，放在企业对象中，与 `auth`/`oidc` 同级；默认 `false` 仅接受 HTTPS，改为 `true` 也接受 HTTP 服务地址。旧 `insecureDevelopmentOrigin` 已废弃并忽略。issuer 身份、资源同源关系及 OAuth/PKCE 校验仍按协议执行。`discoveryUrl` 填完整发现地址，`expectedIssuer` 可选，填写后必须与发现文档完全一致。

其他客户端开发者可使用[单个 Profile 示例](../../examples/litellm.enterprise-profile.example.json)和[桌面宿主指南](../desktop-host.md)，复用同一授权与模型模块；桌面安装用户无需自行装配 Host。

## 3. 登录并使用模型

1. 在 EduWork 账户菜单选择已配置的机构，发起登录；保持客户端运行。
2. 系统浏览器打开 LiteLLM 登录与授权页面。完成账号登录；网关要求选择团队时，选择有相应模型权限的团队并同意授权。
3. 浏览器返回本机回调页面，确认登录完成后回到 EduWork。
4. 在模型选择器中选择该机构的模型，发送一条简短消息确认真实模型响应。

`127.0.0.1` 回调是 EduWork 在用户电脑上临时监听的地址，不是 LiteLLM 服务器地址。浏览器必须在运行客户端的同一台电脑上完成回调；不要收藏或重复打开旧授权链接。

客户端自动读取当前授权的 `/v1/models`，请求使用 Access Token，并在临近到期时刷新。重启后通过本机受保护存储恢复授权。退出登录会清理本地会话并尝试撤销 Refresh Token；Access Token 的剩余有效期由服务端控制。

模型授权和计费仍由 LiteLLM 的用户及团队配置决定，客户端不会给账号增加权限。此接入不提供统一配额面板。模型能力取自目录和管理员核实的配置；目录只有模型 ID 时，客户端按文本模型处理，不根据名称猜测图像或思考能力。能力补充方式见 [Profile 配置](../enterprise-profile.md)。

## 4. 上线前验收

用普通用户完成以下检查，不能只用管理员账号、模型列表或 mock 响应替代真实调用：

| 检查 | 预期结果 |
| --- | --- |
| 登录、拒绝授权、重新登录 | 成功或拒绝状态明确，旧回调不能完成新登录。 |
| 模型目录与真实对话 | 只出现获授权的模型，能收到真实上游返回的内容。 |
| 流式调用 | 实际对话持续接收内容并正常结束；代理不缓冲整个 SSE。 |
| 使用中刷新与重启 | 到期刷新后可继续请求，重启后可恢复登录；无需复制 Token。 |
| 用户 / 团队隔离 | 受限用户看不到也不能调用未授权模型。 |
| 退出 | 本地不再能发起机构模型请求，已撤销的 Refresh Token 不能恢复授权。 |

测试环境可缩短 Token 有效期验证刷新；若通过测试工具模拟临近到期，应注明测试方式。不要把一次登录成功视为刷新已通过，也不要把真实网关加 mock 上游视为真实模型验收。

## 5. 常见问题

| 现象 | 排查方向 |
| --- | --- |
| 发现入口返回 404 或 HTML | 检查 LiteLLM 版本、公开路由和代理转发；应返回 native contract 1 JSON。 |
| issuer / endpoint 校验失败 | 核对 `PROXY_BASE_URL`、公开 HTTPS 地址和 `expectedIssuer`；修正部署配置后重新登录。 |
| 浏览器显示 `127.0.0.1` 拒绝连接 | 确认客户端仍在运行、浏览器与客户端在同一电脑，并从账户菜单发起新登录。 |
| 登录成功但模型列表为空或调用返回 403 | 核对用户、所选团队及模型权限；登录不等于获得全部模型权限。 |
| 换码、刷新失败或请求返回 401 | 检查令牌有效期、网关账号状态和服务日志；轮换 / 撤销在多副本部署中需共享 Redis。 |
| 提示不支持某个思考档位或输入类型 | 按当前目录支持的能力调用；不要强制传入模型不支持的 `reasoningEffort` 或附件。 |
| 流式内容最后一次性出现 | 检查反向代理的 SSE 缓冲和连接超时。 |

提供问题报告时，记录版本、发生阶段、HTTP 状态与已脱敏错误；不要附带授权码、Token 或完整回调 URL。更详细的交互字段见[网关认证协议参考](README.md)。
