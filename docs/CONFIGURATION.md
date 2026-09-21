# 配置文件

[English](CONFIGURATION_EN.md) · [配置示例](../config/desktop/examples/README.md) · [配置与 Skills 更新](CONTENT_UPDATES.md)

公版和机构版 Electron 都只读取一份生效配置：`config/eduwork.jsonc`。可以从设置中的“打开配置文件”打开它；编辑保存后，从托盘退出程序再启动。文件里的机构、模型、功能开关和媒体服务就是客户端使用的配置，不再叠加另一份隐藏的学校配置。

| 平台 | 生效配置 | 唯一回退备份 |
| --- | --- | --- |
| Windows 绿色版 | `<程序目录>/config/eduwork.jsonc` | `<程序目录>/data/configuration/eduwork.previous.jsonc` |
| macOS | `~/Library/Application Support/<distribution>-electron/config/eduwork.jsonc` | 同目录根下 `data/configuration/eduwork.previous.jsonc` |

`distribution` 是发行标识，例如公版为 `eduwork`。Mac 配置和用户数据不写入 `.app`。密码、API Key 和登录令牌仍由凭据存储管理，不写入 JSONC。

## 在配置文件中查阅选项

`eduwork.jsonc` 会在字段旁显示中文说明，文件末尾包含全部通用配置项的注释参考，写明位置、取值、默认行为和互斥关系。可选项的示例保持为注释，填写真实参数后再放入对应对象，避免仅因补全文档就开启服务。安装包适用的插件默认值（包括机构发行的服务地址）会写到本文件的 `plugins` 段；全部附加选项也在本文件中列出。互斥项、自动定位的路径和需要真实凭据引用的可选项保留注释示例，不用到源码中寻找参数。

首次下载和配置更新也会写出这些说明。升级已有安装时补齐缺少的默认值和注释；保留用户注释、现有值和同一份回退备份。缺省的 `organizations[].allowInsecureDevelopment` 显式写为 `false`，已有 `true` 不会重置。

软件更新源也写入同一文件：Windows 保留从旧版迁入的更新源；macOS 的 `updates.macFeeds` 列出公测和开发 appcast。更改 appcast 不改变安装包内的签名公钥。

邮件与记忆的插件默认值也在 `plugins` 中。设置界面保存的个人偏好仍优先；自动定位的运行时路径、当前版本和每机生成的安装标识不固定写成某台机器的值。

## 默认配置和更新

公版默认不启用远程配置管理。机构版可以在首次启动时下载签名默认配置并写入同一文件；已经初始化后，随包引导文件不再覆盖用户编辑过的更新源或配置。

配置更新仍从设置中的“检查更新”操作。下载时不改生效文件，下次启动时验证并写入：

- 未修改的默认字段可以更新。
- 用户修改、新增或删除的字段保留；有冲突时，更新面板显示保留的字段。
- 机构、模型和媒体服务等带 `id` 的列表按标识合并，保留自定义条目。
- 远程内容不能修改更新源、公钥、产品名称或桌面偏好。

每次自动改写前替换固定的 `eduwork.previous.jsonc`，不生成版本号或时间戳备份。内容未通过启动检查时恢复这份备份；更新期间新增的手工修改保留。需要手工恢复时，先退出程序，再把备份复制回生效路径。配置语法错误会指出文件和行号，不会静默改回远程默认值。

旧版升级会把原来实际生效的版本化配置／签名配置迁到统一入口。成功启动后清理本次迁移中确认未再修改的旧版本文件和旧基础缓存。不会扫描其他安装目录；历史、登录凭据和个人模型不迁入配置文件。

## 切换 UAT 或本地测试

直接编辑 `eduwork.jsonc` 中的机构配置：按服务端要求修改 `organizations` 里的 `auth.discoveryUrl`、`auth.expectedIssuer`、`auth.clientId`，以及 `media.providers` 中的服务地址与关联。仅身份登录的 OIDC 使用 `oidc.issuer` 和 `oidc.clientId`；旧 `keyBinding` 已不再支持。参照对应协议和配置示例。

HTTP UAT 只需把对应企业对象中与 `auth` 同级的开关改为：

```jsonc
// false 仅接受 HTTPS；true 也接受 HTTP。无需额外填写开发地址。
"allowInsecureDevelopment": true,
```

该开关用于企业登录、发现、认证端点和模型 API；默认 `false`。旧 `insecureDevelopmentOrigin` 仅兼容读取并忽略，不再需要。服务端 issuer、授权资源及 PKCE 仍按所选协议校验。品牌帮助链接、媒体配置和程序/内容更新源仍遵循各自的地址约定，详见文件内注释。

需要固定测试配置时，把现有 `contentUpdates.configuration` 改为 `false`；Skills 可继续更新。把 `contentUpdates.skills` 也设为 `false` 可停用全部远程内容更新。不要用不完整的 `contentUpdates` 对象替换现有的来源和公钥。

软件的 `updates` 与配置的 `contentUpdates` 分开管理。软件更新渠道的“开发版／公测版”不等于服务端的“UAT／生产”。无需修改程序资源、签名缓存或创建 UAT 配置服务才能测试。长期联调建议使用独立安装和数据目录，避免混用两个环境的会话与登录状态。

## 已安装插件的配置

可选的 `plugins` 对象以发行版中的插件 ID 为键，例如 `"plugins": {"example-service": {"baseURL": "https://uat.example.test/v1"}}`。重启时将这些选项合并到已安装插件；它不能安装插件，未知 ID 会提示配置错误。具体字段查阅发行版和插件文档。切换 UAT 时应一起修改机构服务、登录和媒体的地址。远程内容配置不会覆盖这个本地配置区。

## 内部状态

`data/content-updates/` 保存经过校验的下载内容，`data/configuration/state.json` 保存修订、字段指纹和事务状态。这些用于验签、合并和恢复，不是另一个生效配置入口，也不需要手工编辑。
