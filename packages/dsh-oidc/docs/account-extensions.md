# 机构账户扩展接口

**简体中文** | [English](account-extensions.en.md)

公共 OIDC 负责身份、Token 授权、模型及默认选择和退出。配额请求、解析和展示由可选机构扩展提供；resources(profileID) 只返回模型元数据。当前客户端不再申请或迁移模型 API Key；Host 与 Client 描述符应配套部署。

## Host 授权传输

机构插件可以依赖 `oidcAccounts` 服务，但必须先用自己的显式 `profileIDs` 白名单判断请求对象。不能仅凭“安装在机构发行版”就查询用户后来添加的其他企业。

```js
const response = await ctx.oidcAccounts.modelResourceFetch(profileID, '/quota', { signal })
```

这是 Host 专属方法，**没有 Remote 标记**，不向客户端返回 Key。请求使用已校验的网关 API 基址和当前 Access Token，要求有效的 auth 模型授权。只允许 GET，路径必须是 `/segment` 形式（字母、数字、下划线、连字符，可多级），拒绝 URL、查询、片段、编码路径、点段和额外请求选项。请求不跟随重定向，超时 20 秒，缓冲响应最多 1 MiB。HTTP 错误仍返回 Response，由扩展定义友好状态。网络异常和身份变化可能抛出错误；扩展不得向 UI 回显原始请求或响应中的秘密。

读取响应期间注销或替换 Key 会拒绝结果。扩展还必须在自身层订阅 `oidc/accounts-changed` 和 `credentials/reference-updated`，失效正在请求的账户快照；每次异步操作结束后检查世代编号，不能将旧用户结果写入新用户状态。扩展卸载时中止请求。公版不缓存扩展资源。

需要 OAuth Access Token 的机构服务使用 `authorizedFetch(profileID, endpoint, init, authorization?)`。`auth` 模式在请求前检查到期时间，剩余不超过 90 秒时先刷新；GET/HEAD 收到 401 后最多刷新并重试一次。可安全重复提交的机构请求（例如活跃心跳）可显式传入第四个参数 `{ retryUnauthorized: true }`，为 POST 启用相同的一次恢复；请求正文须为已缓冲的字符串或为空，不接受流式正文。该选项只供受信 Host 代码使用，不进入 HTTP 请求或客户端 RPC，也不扩大目标 origin/路径白名单。模型生成请求不启用此选项，不自动重放；同一授权的正常 Token 刷新不会取消正在进行的流。见 [公共身份与资源协议](public-resource-protocol.md)。这两个方法都不会自动触发业务请求。

成功重新登录或注销会发出带 `authorizationChanged: true` 的 `oidc/accounts-changed` 事件，即使前后 `state` 都是 `connected`。扩展必须清理旧授权的失败状态及在途结果，不能仅按状态名称去重；普通状态轮询仍只在状态变化时发通知。

## 客户端账户菜单

公共 `ui.sidebar.footer.account` 注册一个官方 DSH 子插槽 `oidc.account.menu.details`，类型 `single`、作用域 `root`。可选扩展通过 `slots.inject()` 等待插槽，然后 `slots.register()` 注册组件。公共部分始终拥有身份信息、登录、模型凭据创建及注销；扩展只提供中间附加内容。

组件接收以下 owner props：

| 字段 | 含义 |
| --- | --- |
| `profile`, `status` | 当前受信配置与无秘密的账户状态；不可修改 |
| `busy` | 公共账户操作进行中，扩展操作应禁用 |
| `run(operation)` | 运行用户操作，复用忙碌及错误呈现；operation 不应泄露响应正文 |
| `refreshAccount()` | 重新核实账户和模型连接，不自动 Provision |
| `defaultContent` | 公共“刷新账户”按钮；不适用的组织必须返回它 |

```js
ctx.slots.inject('oidc.account.menu.details', () =>
  ctx.slots.register({ name: 'oidc.account.menu.details', priority: -100 }, Details))
```

扩展自定义 RPC 与字段 schema 归自己的包。组件必须根据明确配置的 profile ID、Provider 是否存在和 `status.credentialReady` 决定是否读取；不匹配或未获得有效模型授权 时返回 `defaultContent`，不得请求配额。账户切换、退出及组件卸载后丢弃迟到结果。可聚焦操作使用 `role="menuitem"`，复用公共菜单的方向键、Escape 与失焦关闭规则。刷新不应夺走用户后来选择的个人模型。

ECNU 发行方的独立扩展可以提供模型额度、资源包、重置时间、详情和刷新。数量缺失代表未知；没有总量不能绘制百分比。该业务及其 `/quota` wire 不属于公共资源协议。
