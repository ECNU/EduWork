# 首次启动获取机构配置

[English](PUBLISHER_BOOTSTRAP_EN.md) · [配置文件](CONFIGURATION.md) · [内容更新](CONTENT_UPDATES.md) · [构建指南](BUILD.md)

机构发行可以直接分发 GitHub CI 生成的 Electron 原包。包内只携带发行身份、更新渠道和验签公钥，客户端在首次启动时下载机构配置。Windows 与 macOS 复用同一套实现，无需为了加入机构配置再修改 ZIP 或制作配置 PKG。

公版默认仍读取用户配置，不联系任何学校的配置服务。此功能由机构发行明确启用，不改变使用公版加本地配置的部署方式。

## 启用方式

发行资源中提供 `desktop/configuration-policy.json`，设置 `ownership: "publisher"`；再通过发行的 `resources` 将 `desktop/publisher-bootstrap.json` 放入产品目录。后者包含更新渠道与验签信息：

```json
{
  "schemaVersion": 1,
  "updates": {
    "provider": "static",
    "manifestURL": "https://downloads.example.org/app/development/latest-windows-amd64.json"
  },
  "contentUpdates": {
    "publisher": "example",
    "baseURL": "https://downloads.example.org/content",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n<Ed25519 SPKI 公钥>\n-----END PUBLIC KEY-----\n",
    "configuration": true,
    "skills": true,
    "bundled": { "configuration": 0, "skills": 0 }
  }
}
```

示例公钥必须替换后才能构建可用发行。`updates` 是软件更新源，遵循[现有协议](UPDATES.md)；`contentUpdates` 是签名配置与 Skills 更新源。软件更新地址中的渠道只是源定位信息，不能代替用户的渠道偏好。默认渠道由桌面打包的 `UpdateDefaultPolicy` 控制；macOS 未显式指定时，开发版本为 `development`，其他版本为 `stable`。引导文件不允许写 `defaultPolicy`；用户已保存的选择始终优先。

`configuration` 必须开启，内置配置修订号必须为 `0`。Skills 可选择继续使用随程序安装的版本（`skills: false`），也可一起远程管理。最新签名清单必须包含所授权组件的完整快照。所有支持的渠道都须有兼容清单；没有公测配置时，不能发布默认使用公测渠道的新安装包。

随包 `desktop/eduwork.jsonc` 只保留公开产品名称、空机构目录与安全默认值。Client ID、模型目录和媒体服务参数放入签名内容包；密码、Client Secret、个人 Key、登录令牌、签名私钥不能放入任何客户端配置包。下载只是分发方式，不会让客户端最终获得的参数变成保密信息。

## 启动与回退

发行方可以另提供完整的 `desktop/publisher-bootstrap.win32.json`、`desktop/publisher-bootstrap.darwin.json` 或 `desktop/publisher-bootstrap.linux.json`。客户端优先使用当前平台的文件；只有该文件不存在时才回退到通用文件，格式错误不会改用其他平台的来源。各平台可以分别管理配置、Skills、修订号和兼容性要求，通用文件仍兼容已有发行。初始化后，实际来源保存在唯一的 `config/eduwork.jsonc` 中；更换包内默认值不会覆盖用户保存的来源。

1. **首次安装：** 将随包默认更新源写入 `config/eduwork.jsonc`，下载并校验签名、大小、摘要、组件和依赖，然后把学校配置写入同一个文件。桌面成功启动后才提交内容修订。
2. **无法下载：** 提供重试与签名离线包导入，不删除数据。
3. **已有安装：** 直接读取本地 `eduwork.jsonc`，不依赖网络；不再叠加隐藏配置。包内引导信息只负责初始化，之后本地文件中的来源、公钥和开关生效。
4. **旧版升级：** 将已验证内容与旧基础配置合成为一个生效文件。成功启动后清理本次确认未修改的旧版本配置和旧基础缓存；不扫描其他安装或凭据目录。
5. **配置更新：** 更新未修改的默认字段，保留手工修改、增加和删除，有冲突时提示字段路径。启动失败恢复唯一备份 `data/configuration/eduwork.previous.jsonc`，不生成更多副本。

Windows 配置位于安装目录的 `config/eduwork.jsonc`；macOS 位于 `~/Library/Application Support/<distribution>-electron/config/eduwork.jsonc`，不写入 `.app`。`data/content-updates/` 的签名下载内容和 `data/configuration/state.json` 的字段指纹、事务记录均为内部状态，不作为隐藏配置层。语法错误不会被远程配置静默修复；用户可以按[配置说明](CONFIGURATION.md)修改或恢复文件。

## 迁移旧配置源

需要同步升级配置协议时，可在包内引导文件增加 `migrateFrom: ["https://downloads.example.org/old-content"]`。它只声明旧内容源地址；迁移要求发行者、公钥均与新源一致，不允许借此更换信任密钥。自定义地址、公钥、关闭配置更新或显式指定测试配置的安装不迁移。

客户端先校验并读取旧来源的有效配置，再切换到新源，等待新签名配置下载、验签与依赖检查完成后才启动 Host。新来源使用独立修订号。首次下载失败可以重试，未通过启动检查的配置按内容更新事务回退。已有本地修改和附加机构条目保留；迁移成功后仍只使用 `config/eduwork.jsonc` 和一份回退备份。此前尚未配置内容更新源的机构安装，也会在启用此声明后完成首次配置下载。

必须先部署新内容源，再分发包含迁移声明的软件；旧源需保留供旧软件使用。无需迁移时不要设置 `migrateFrom`。

## 离线包与发布顺序

`scripts/create-content-update.mjs` 除在线清单、内容包和回执外，还生成 `content-<revision>-offline.json`。将此文件交给无法联网的用户，通过首次启动窗口导入即可。导入遵循相同的渠道、签名、依赖、防倒退和启动检查规则，不接受普通未签名 JSONC 代替离线包。

发行时先准备并验证兼容目标程序、平台和工具能力的签名内容，再上传不可变内容包，最后切换相应渠道的 `latest.json`。确认全新安装可以获取配置后，再开放程序下载。验证至少覆盖全新安装、断网重启、旧配置升级和失败回退。含平台相关 Skills 时，需要逐平台验收，不能仅删除 `platforms` 限制就宣称兼容。

CI 中的桌面启动检查使用隔离的合成机构配置，不依赖真实学校服务；首次下载、签名和回退由本地合成测试覆盖。真实登录与目标平台体验仍需发布前验收。此功能解决配置交付；macOS 的 Developer ID 签名、公证和整包自动更新仍按 [Mac 说明](MACOS.md)分别处理。
