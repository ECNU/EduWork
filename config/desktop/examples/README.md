# 配置示例

[English](README_EN.md)

模型请求总并发默认 3 路，所有主会话、子代理与辅助模型请求共用这个上限。设置 → 通用设置 → 模型请求总并发支持即时保存；填 2 就是总计 2 路，超额请求排队。在 `config/eduwork.jsonc` 顶层设置 `"features": { "maxConcurrentRequests": 3 }` 可提供发行默认值（1–64），退出后重启生效；用户已保存的并发偏好优先。旧 `maxParallelSubagents: 2` 兼容换算为总并发 3，不改配置文件原文。Windows 更新设置可选择“公测版”或“开发版（含公测版）”，不因切换渠道降级。

- [organization.jsonc](organization.jsonc)：完整第三方企业 OIDC / Key / 模型配置。
- [media.jsonc](media.jsonc)：按服务商配置图像生成与云端 TTS，共用对话和 Studio 工具；无须学校媒体插件。
- [updates.jsonc](updates.jsonc)：Windows 公版默认 GitHub 更新；示例说明如何切换静态 HTTPS 源、配置 GitHub 仓库或关闭更新，不要求使用 OSS。
- [默认配置](../eduwork.jsonc)：可直接编辑的配置，带完整注释。

桌面安装目录对应 `config/eduwork.jsonc` 和 `config/examples/`。将示例中需要的段落复制到生效配置，填写服务端公开域名、公共 Client ID、机构名称后，从托盘退出并重新启动。多个机构使用不同的稳定 `id`；启用托管模型时，各机构的 `provider.id` 也必须唯一，并与各自服务端 bootstrap 返回值匹配。不能只修改客户端 Provider ID 来消除冲突，应由服务端提供不同路由标识，或分开使用不同客户端配置。

配置不是秘密存储。不要写密码、API Key、client_secret 或登录令牌；个人 Key 在模型设置中输入，企业 Key 由登录流程保存在本机受保护存储。企业运行凭据引用统一为 `EDUWORK_API_KEY`。

只在 CI 包中加入机构配置时，使用[配置装配指南](../../../docs/BUILD.md#从-ci-原包装配机构配置)。支持继承随包默认值、GitHub、静态 HTTPS 源或关闭更新。

发行方可随包提供企业模型能力修正，在启动时同步匹配的企业目录。它不改配置文件原文、个人 Provider 或默认模型选择；使用 `modelSource: "discovery"` 的目录仍由服务器提供。公版没有内置任何学校的修正规则。

没有企业时保留空 `organizations` 数组。只做身份登录时同时省略 `keyBinding` 与 `provider`。需要自动获得 Key 和模型时，服务端应实现资源协议；标准 OIDC 登录本身不会凭空提供模型目录。

界面名称与 Logo 可配置。Logo 放在生效配置旁的 `assets/` 目录，以相对路径引用。修改 EXE 图标和应用 ID 仍需发行方重新装配。配置、用户 Logo 和 `data/` 必须在更新时保留。

学校具体部署示例与专有服务在 [EduWork-ECNU](https://github.com/ecnu/EduWork-ECNU/tree/main/edition/desktop-examples)。公版不会因填入某个学校地址就安装该学校的专有插件。
