# 首次启动获取机构配置

[English](PUBLISHER_BOOTSTRAP_EN.md) · [内容更新](CONTENT_UPDATES.md) · [构建指南](BUILD.md)

机构发行可以直接分发 GitHub CI 生成的 Electron 原包。包内只携带发行身份、更新渠道和验签公钥，客户端在首次启动时下载机构配置。Windows 与 macOS 复用同一套实现，无需为了加入机构配置再修改 ZIP 或制作配置 PKG。

公版默认仍读取用户配置，不联系任何学校的配置服务。此功能由机构发行明确启用，不改变使用公版加本地配置的部署方式。

## 启用方式

发行资源中提供 `desktop/configuration-policy.json`，设置 `ownership: "publisher"`；再通过发行的 `resources` 将 `desktop/publisher-bootstrap.json` 放入产品目录。后者只允许以下三个顶层字段：

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

1. **首次安装：** 读取随包更新源，下载并校验签名、大小、摘要、组件和客户端依赖，再启动工作台。成功打开桌面后才提交内容版本。
2. **无法下载：** 显示重试与导入签名离线包入口，不删除数据。网络恢复后重试即可，不要求重装。
3. **已有安装：** 优先使用已验证缓存，不等待网络。进入工作台后按原有更新流程检查新内容，失败时保留现有配置。
4. **从旧发行升级：** 在原配置所在目录查找不高于当前程序版本的版本化配置，再考虑旧 `eduwork.jsonc`。只复制机构目录、功能和媒体配置，保留关闭窗口偏好；不改旧文件，不扫描其他安装、不搬运登录凭据。更新源和公钥始终采用新包的声明。
5. **启动失败：** 新内容未通过启动检查时回退到之前的内容或旧配置。全新安装没有可回退配置时，等待修正版本，不循环启用失败内容。损坏的已提交配置可以重新获取同一份签名内容，不降低版本号。

Windows 缓存位于安装目录的 `data/publisher-bootstrap/<源标识>/` 和 `data/content-updates/<源标识>/`；macOS 位于 `~/Library/Application Support/<distribution>-electron/data/` 下的同名目录。源标识绑定发行 ID、发布者、URL 与公钥。`.app` 内的引导资源只读，内容更新不能修改自己的信任根。实际生效配置由基础缓存与已验证内容叠加，不能只凭某个旧 JSONC 文件判断模型配置。

## 离线包与发布顺序

`scripts/create-content-update.mjs` 除在线清单、内容包和回执外，还生成 `content-<revision>-offline.json`。将此文件交给无法联网的用户，通过首次启动窗口导入即可。导入遵循相同的渠道、签名、依赖、防倒退和启动检查规则，不接受普通未签名 JSONC 代替离线包。

发行时先准备并验证兼容目标程序、平台和工具能力的签名内容，再上传不可变内容包，最后切换相应渠道的 `latest.json`。确认全新安装可以获取配置后，再开放程序下载。验证至少覆盖全新安装、断网重启、旧配置升级和失败回退。含平台相关 Skills 时，需要逐平台验收，不能仅删除 `platforms` 限制就宣称兼容。

CI 中的桌面启动检查使用隔离的合成机构配置，不依赖真实学校服务；首次下载、签名和回退由本地合成测试覆盖。真实登录与目标平台体验仍需发布前验收。此功能解决配置交付；macOS 的 Developer ID 签名、公证和整包自动更新仍按 [Mac 说明](MACOS.md)分别处理。
