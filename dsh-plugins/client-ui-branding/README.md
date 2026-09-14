# EduWork 品牌与配色

[English](README_EN.md)

可移除的 DSH Client UI 品牌层，复用官方 Sidebar、对话首屏品牌插槽与 `theme.overrideTokens()`。默认名称为 **EduWork**，使用通用图标和蓝色风格；不包含机构徽标或按品牌名判定业务能力的逻辑。

发行配置在 `brand-settings-native` 中提供：

```yaml
product:
  name: EduWork
  logoUrl: ''
  styleLabels:
    dsh: 蓝色
    ecnu-liwa: 红色
visualStyle: dsh
```

机构发行可注入自己的名称、图片 URL 或 data:image URL，以及风格名称。`logoUrl` 支持同源绝对路径、HTTP(S) 图片或 image data URL，不读取用户电脑任意文件路径。侧栏、对话首屏、网页标题和页签图标消费同一配置。

客户端从 settings 的 composition `base.product` 读取发行身份，避免旧 Profile 中的品牌覆盖污染新发行；`visualStyle` 仍读取用户偏好。`chatecnu-brand`、`ecnu-liwa` 与既有 CSS 标识保留是为兼容已保存设置，不决定机构服务。默认风格为蓝色，已保存的红色偏好保持。

本插件只增加一行“配色”设置，公版同样可以直接切换蓝色/红色。`src/theme.js` 提供中性的 `COLOR_SCHEME_TOKENS` 与 `RED_TOKENS` 导出；蓝色值为 `null`，表示直接采用官方主题。其他插件继承 `--dsw-*` token，不复制红色值或依赖机构命名。Agent 预设、模型、Skills 与插件目录继续使用各自官方入口；不复制设置页，不改 `@deepseek-ai/*` 的运行文件。

构建使用锁定官方源码：`build-client.ps1 -Upstream <source> -DshLockPath <lock> -Output <artifact-lib>`。构建器在官方源码的 `packages/extensions` 放置自己的临时扩展目录，完成后清理；不要与官方整体构建并行。
