# 可选品牌素材

默认 `theme: modern-clean`，以及 `academic-editorial`、`digital-tech`、`warm-education` 都使用通用主题，不需要学校或企业素材。本公开包不包含品牌背景、校标或其他机构图片，也不会从机构网站下载它们。

只有用户明确选择 `theme: ecnu-liwa`，或者重建含旧 `profile` 的历史规格时，才启用原有 ECNU 品牌行为。历史 `profile` 包括 `liwa-modern`、`academic-editorial`、`digital-campus`；它们和顶层 `theme` 互斥，不能一起提交。新任务使用通用 `theme`，不要为消除缺失素材错误而自动改写用户指定的品牌。

宿主须将 `DSH_OFFICE_BRAND_ASSETS` 指向已准备的素材目录，其中保留兼容文件名：

- `ecnu-background.jpg`：品牌背景。
- `ecnu-logo-form-a.png`：横向标志组合。
- `ecnu-logo-form-c.png`：圆形标志。

这些文件名是历史渲染接口，不表示文件已随包提供。素材的来源、权利人和授权说明由提供素材的部署方保留，项目代码的 MIT 许可证不授予机构标识的使用权。缺少必需素材时，品牌主题明确报错；通用主题不受影响。

注入后，品牌主题沿用固定背景、标志与 ECNU 红 `#9B2034` 等原有视觉规则。JSON 规格不能覆盖素材路径、颜色或坐标。主题选择和通用示例见 [presentation-spec.md](presentation-spec.md) 与 [profile-library.md](profile-library.md)。

普通验证检查结构、安全和确定性布局；配色等设计建议进入 `quality_warnings`。`--strict` 用于模板回归，可将设计告警升级为失败。
