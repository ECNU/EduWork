# macOS 应用更新

**简体中文** | [English](MACOS_UPDATES_EN.md)

macOS 使用 Sparkle 的原生窗口检查、下载、校验和安装更新。启动后的检查不弹窗；用户在应用的更新入口确认下载和安装。应用退出后由 Sparkle 替换 `.app` 并重新启动；无写入权限时可能需要系统授权。Windows 继续使用绿色版更新器。

应用之外的配置、会话、凭据和 Skills 保留在用户目录。配置与 Skills 更新和程序更新共用设置入口，程序更新不会覆盖它们。旧 Mac 包没有 Sparkle，首次需要手动替换到包含此组件的版本，此后才支持该流程。

## 发行配置

机构发行可将以下文件装配到 `resources/desktop/mac-updates.json`。也可在 Mac CI 配方中指定 `-MacUpdateConfig <文件>`。这个文件只包含公开更新地址和验证公钥，不包含私钥或登录配置。

```json
{
  "schemaVersion": 1,
  "feeds": {
    "stable": "https://downloads.example.org/macos/stable/appcast.xml",
    "development": "https://downloads.example.org/macos/development/appcast.xml"
  },
  "publicEDKey": "替换为 Ed25519 公钥原始 32 字节的 Base64"
}
```

CI 按 `dsh-electron/sparkle.lock.json` 下载并校验框架，编译主进程桥接并签名完整应用。缺少配置时禁用程序更新；配置不完整时构建失败。渠道偏好保存在用户目录；开发渠道清单应同时包含最新开发版与更新的公测版。公测渠道只提供公测版，切换渠道不降级。

`CFBundleVersion` 和 appcast 必须使用同一个编码：`0.3.6-dev.20260920.1` 对应 `0.3.6dev20260920.1`，公测版对应 `0.3.6`。不要直接把含连字符的版本交给 Sparkle：其比较器会忽略该后缀。原生 CI 验证逐日开发版、公测版、下个版本之间的排序。

## 签名与发布

每个发行维护自己的 Ed25519 私钥；公钥固定在客户端里。生成新 ZIP 后，校验构建回执并签名：

```sh
node scripts/macos-update-feed.mjs sign app.zip release-receipt.json mac-updates.json private-key.pem https://downloads.example.org/app.zip appcast.xml
```

命令仅生成清单，不上传、创建 GitHub Release 或切换更新入口。先上传完整 ZIP，再发布指向它的 appcast；公测发布时也更新开发渠道。私钥丢失会影响后续更新，必须在仓库外妥善备份。私钥不能随安装包、源码或 CI 日志公开。

EdDSA 负责验证更新来源，不能代替 Apple Developer ID 和公证。ad-hoc 包首次打开仍可能出现 macOS 安全提示。原生 CI 使用临时密钥验证真实桥接、HTTPS 检查、错误签名拒绝和应用替换；系统授权弹窗、Gatekeeper 与用户交互仍需对应系统真机验收。
