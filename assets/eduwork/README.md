# EduWork Logo

[English](README_EN.md)

`mark.svg` 是矢量母版，以折页形 E 表达资料转化为工作成果。图标使用同一轮廓的白色剪影，红色为默认品牌色。公版与机构版共用红色应用图标；界面仍可选择蓝色，已保存的配色偏好保留。`icon.svg`、各尺寸 PNG、ICO 和 ICNS 均为红色默认图标；`icon-blue.svg` 保留蓝色变体。机构 Logo 由 `config/eduwork.jsonc` 的 `product.logoFile` 覆盖，不改变发行版应用标识。

修改母版后运行 `node scripts/build-eduwork-icons.mjs --sharp <sharp 模块入口>`，生成 PNG、Windows 多尺寸 ICO、macOS ICNS、单色托盘资源和客户端路径常量。macOS 装配使用同一组红色 ICNS 与 PNG；完整平台支持仍需按 [macOS 指南](../../docs/MACOS.md) 验收。资源随本项目 MIT 许可提供。
