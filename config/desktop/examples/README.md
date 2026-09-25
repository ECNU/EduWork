# 配置示例

[English](README_EN.md) · [生效配置、备份与 UAT](https://github.com/ECNU/EduWork/blob/main/docs/CONFIGURATION.md)

公版默认不自动下载机构配置。安装包提供这些示例，生效文件是设置 → **打开配置文件** 打开的 `eduwork.jsonc`；只修改 `examples/` 中的示例不会生效。文件支持注释，末尾还有全部配置项的注释参考，按需启用。

## 选择示例

- [litellm.jsonc](litellm.jsonc)：通过 LiteLLM 网关账号登录并使用模型，下面有完整操作步骤。
- [organization.jsonc](organization.jsonc)：通过机构的 oidc-llm 服务登录并使用模型，需要管理员提供公开 Client ID；协议仍为实验性。
- [media.jsonc](media.jsonc)：按服务商配置图像生成与云端 TTS，共用对话和 Studio 工具；无须学校媒体插件。
- [updates.jsonc](updates.jsonc)：Windows 公版默认 GitHub 更新；示例说明如何切换静态 HTTPS 源、配置 GitHub 仓库或关闭更新，不要求使用 OSS。
- [同目录上一级配置](../eduwork.jsonc)：带完整注释。安装后以设置打开的文件为准；源码目录里的同名文件是模板。

上述两种网关登录已包含在 **EduWork 0.3.6-dev.20260921.1** 中，不需要额外安装插件。LiteLLM 协议基线为 **v1.101.0 / native contract 1**；其他服务端版本应先确认兼容性。

## 接入 LiteLLM：改哪里、填什么

1. 向网关管理员获取完整发现地址，例如 `https://gateway.example.org/.well-known/litellm-cli-auth`。它应能直接返回 JSON；服务端需启用 LiteLLM 原生 CLI OAuth 登录，并为你的账号分配可用模型。服务端准备见 [LiteLLM 接入指南](https://github.com/ECNU/EduWork/blob/main/packages/dsh-oidc/docs/gateway-auth/litellm-setup.md)。
2. 从设置打开生效配置，再打开旁边 `examples/litellm.jsonc`。把示例 `organizations` 数组里的对象加入生效配置的同名数组；数组为空时直接填入，已有其他机构时追加。不要用整个示例覆盖已有的媒体、更新和插件设置。
3. 修改下面的字段，其余字段保留示例值。LiteLLM **自动注册 Client ID，不需要填写 `clientId`、`client_secret` 或 API Key**；模型 API 地址和模型目录会自动发现。
4. 保存文件，从托盘或应用菜单选择“退出”，再启动 EduWork；关闭窗口可能只会收起到托盘。
5. 从账户入口选择你填写的机构名称，浏览器登录网关账号、按提示选择团队并授权；回到 EduWork 选择获授权的模型，新建会话发送一条消息。

| 示例中的字段 | 你需要填写什么 |
| --- | --- |
| `id` | 本机唯一标识，例如 `my-litellm`；日常使用保持不变，不是服务端分配的 Client ID。 |
| `displayName` | 登录入口显示的名称，例如“公司模型网关”。 |
| `auth.discoveryUrl` | 完整发现地址，包含 `/.well-known/litellm-cli-auth`；不是 `/ui` 或 `/v1`。 |
| `auth.expectedIssuer` | 发现 JSON 里的 `issuer` 原值，须完全一致；通常是 `https://gateway.example.org`。 |
| `allowInsecureDevelopment` | HTTPS 保持 `false`；HTTP 测试环境改为 `true`，位于机构对象里、与 `auth` 同级。 |

例如本机网关运行在 4000 端口时，发现地址填 `http://127.0.0.1:4000/.well-known/litellm-cli-auth`，issuer 填 `http://127.0.0.1:4000`，HTTP 开关设为 `true`。`127.0.0.1` 指运行 EduWork 的这台电脑；远程网关应使用管理员提供的可访问地址。

| 平台 | 公版生效配置 |
| --- | --- |
| Windows | `<程序目录>/config/eduwork.jsonc` |
| macOS | `~/Library/Application Support/eduwork-electron/config/eduwork.jsonc` |

`examples/` 与生效配置在同一目录；macOS 首次启动会把示例复制到用户配置目录，不编辑 `.app` 包内文件。没有模型时先确认网关账号/团队权限；查看配置时不要把“能登录网关网页”等同于“已启用 CLI OAuth”。

## 其他配置

模型请求总并发默认 3 路，当前 Host 的所有主会话、子代理与辅助模型请求共用这个上限，超额请求排队。设置 → 通用设置 → 模型请求总并发支持即时保存；不限制其他客户端或独立媒体接口。

DSH 0.1.7-rc.1 的子代理数量默认改为 2，可在插件 → Subagent 中修改。同一主 Agent 下所有递归层级共用这个数量，主 Agent 不计入；达到上限时拒绝新建子代理。它与总请求并发分别生效，没有固定预留的主会话名额。

`eduwork.jsonc` 的 `"features": { "maxConcurrentRequests": 3, "maxActiveSubagents": 2 }` 提供两项默认值（均为 1–64），退出后重启生效。界面已经保存的数值优先，即使与旧默认值相同也保留；仅调整文件不会覆盖它。旧 `maxParallelSubagents: 2` 仍只换算为总请求并发 3，不控制官方子代理数量。0.1.5 不使用 `maxActiveSubagents`。

签名配置更新可通过 `features` 下发这两项默认值；修改过的本地配置继续优先。包含新字段的配置必须要求支持此字段的新客户端版本，并限定 DSH 0.1.7-rc.1，不能下发给尚未升级的客户端。

Windows 更新设置可选择“公测版”或“开发版（含公测版）”，不因切换渠道降级。

多个机构使用不同的稳定 `id`；显式配置 `provider.id` 时也必须唯一。模型 API 地址由通过校验的服务发现提供。

如果服务端目录混有 embedding、rerank、生图或 TTS，可设置 `organizations[].provider.chatModelIds` 为对话模型 ID 数组。它与服务器授权目录取交集，不按名称猜类型，不影响独立媒体服务。省略时保留全部发现条目，`[]` 不注册对话模型；`provider.models` 仍只补充能力。参见 [Profile 说明](../../../packages/dsh-oidc/docs/enterprise-profile.md#provider-对象)。须先升级到支持此字段的客户端，再下发配置。

配置不是秘密存储。不要写密码、API Key、client_secret 或登录令牌；个人 Key 在模型设置中输入，登录 Token 由共享 Host 保存在本机受保护存储，并按机构隔离、自动刷新。

只在 CI 包中加入机构配置时，使用[配置装配指南](https://github.com/ECNU/EduWork/blob/main/docs/BUILD.md#从-ci-原包装配机构配置)。支持继承随包默认值、GitHub、静态 HTTPS 源或关闭更新。

发行方可随包提供企业模型能力修正，在启动时同步匹配的企业目录。它不改配置文件原文、个人 Provider 或默认模型选择；使用 `modelSource: "discovery"` 的目录仍由服务器提供。公版没有内置任何学校的修正规则。

没有企业时保留空 `organizations` 数组。只做身份登录时配置 `oidc` 并省略 `auth` 与 `provider`。模型接入使用 `auth` 配置网关发现，Token 直接访问模型；旧 `keyBinding` 配置已移除。标准 OIDC 登录本身不会提供模型目录。

界面名称与 Logo 可配置。Logo 放在生效配置旁的 `assets/` 目录，以相对路径引用。修改 EXE 图标和应用 ID 仍需发行方重新装配。配置、用户 Logo 和 `data/` 必须在更新时保留。

学校具体部署示例与专有服务在 [EduWork-ECNU](https://github.com/ecnu/EduWork-ECNU/tree/main/edition/desktop-examples)。公版不会因填入某个学校地址就安装该学校的专有插件。
