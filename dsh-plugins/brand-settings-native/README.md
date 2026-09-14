# 品牌与界面偏好

[English](README_EN.md)

Host 插件 `chatecnu-brand` 持久保存配色和详情侧栏宽度，使偏好不依赖随机本机端口或浏览器 localStorage。浅色、深色和跟随系统仍由 DSH 原生设置管理。

`upstreamWelcomeNoticeVersion` 可在客户端启动前将指定版本写入 `ui-onboarding`，用于确认发行方已认可的上游欢迎说明；省略时保留 DSH 默认行为。移除 Host 和客户端品牌插件即可恢复 DSH 外观，无需迁移用户数据。

## 产品与用户配置

`product` 支持 `name`、`logoUrl` 和 `styleLabels`。产品身份来自装配配置，不据此启用机构服务；用户设置仅控制配色和侧栏宽度。

持久设置保留 `chatecnu-brand` 命名空间与 `ecnu-liwa` 样式 ID，以兼容已有配置。新公版配置默认蓝色 `dsh`；已有红色偏好继续保留，机构发行也可显式设置红色默认值。

## 可选 Agent 预设

可选预设策略使用官方 `ctx.agentPresets.roots`，不依赖环境变量猜测路径。兼容旧 DSH 0.1.2 时，可从固定产品预设根目录配合 `DSH_PRODUCT_PRESET_DIR` 管理覆盖文件。

Web 未提供产品预设根目录时沿用官方预设列表。提供根目录或启用 `manageOptionalPresets: true` 时，两个路径都必须是绝对路径，且与运行时预设根目录匹配。`manageOptionalPresets: false` 只关闭可选预设策略，品牌偏好仍可使用。
