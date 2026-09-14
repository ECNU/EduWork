---
name: artifact-presentations
description: 使用共享成果组件的 office_presentation 工具创建、检查和验证多种风格的 PowerPoint PPTX 演示文稿。当用户要制作汇报、讲座、项目介绍、课程或会议幻灯片，或要查看 .pptx 的页面结构、文本和主题合规情况时使用。仅支持 .pptx；不驱动本机 PowerPoint，不支持旧版 .ppt、动画编排或宏。
---

# 演示文稿

创作前阅读[共同规范](../shared/references/common.md)和[本类创作规范](../shared/references/presentations.md)。这些文件同时用于 Studio 生成；此处只补充工具操作。

用语义版式和可选择的主题创建宽屏 PPTX，默认 `modern-clean`。机构主题仅在宿主提供对应素材且用户明确选择时使用；缺少机构素材不影响通用主题和用户本地图片。

## 工作流

1. 先确定受众、场合、时长和希望页数。缺少会显著改变内容的信息时再追问。
2. 按共享演示内容规范组织故事线和页面。
3. 阅读 [references/profile-library.md](references/profile-library.md) 的选择表和场景配方，只选一个 `theme`。主题选择与追问遵循共享规范；保留用户明确选择。
   - `modern-clean`：通用、克制、默认；
   - `academic-editorial`：论文、讲座、研究叙事；
   - `digital-tech`：产品、数据、科技发布；
   - `warm-education`：课程、教育、人物与校园活动；
   - 机构装配可额外提供品牌主题；兼容主题 `ecnu-liwa` 需要宿主的品牌素材，仅在用户明确要求对应品牌时选择。
4. 阅读 [references/presentation-spec.md](references/presentation-spec.md)，优先使用 `timeline`、`feature-grid`、`roadmap`、`image` 等语义版式，再补少量 `bullets`。图片路径必须是当前项目内的绝对路径。
5. 根据共享内容规范和所选主题参考自查计划，不另设叙事比例门槛。
6. 调用 `office_presentation` 的 `create`。规格、路径或素材错误必须改正；设计建议不应阻断创建。如果输出已存在，先向用户确认或换新文件名，工具不会静默覆盖。
7. 调用 `validate`。默认验证只阻断结构、安全和可确定判断的排版错误，例如文件损坏、资产缺失、越界或文本溢出。报告中 `valid`、`structural_valid` 为 `true` 即表示文件结构可交付。
8. 阅读 `quality_warnings`，并结合 `inspect` 判断是否影响当前交付。它们是设计提示，不代表 PPTX 无效；完整有效的文件可以交付，不因纯版式建议反复重新生成。空间不足由共享生成器自动换行或续页，不删减正文。
9. `validate` 的 `strict: true` 只用于 CI 和内置模板回归，把质量告警升级为失败；普通用户任务不得默认启用。
10. 产物已接入共享真实文件预览，可展开、缩放和下载；结构化预览不等同于 PowerPoint 真实渲染，也不表示已完成视觉模型复核。不要凭结构检查宣称“无排版问题”。

## 工具契约

调用 `office_presentation`，参数为 `action`、按需提供 `input_path`、`output_path`、直接对象形式的 `spec`（旧版 `spec_json` 字符串仍兼容，二者只传一个） 和仅供回归的 `strict`。路径必须在当前项目内且使用相对路径；写操作由 DSH 权限层统一确认，PPTX 产物会进入预览链路。私有 Python、品牌资产与脚本路径由插件管理，Agent 不应自行寻找或安装。

## 约束

- 只读写当前项目内文件，不展开 `~`，不访问网络、用户 Home 或凭据。
- PPTX 容器最大 256 MiB，展开内容最大 512 MiB；项目图片最大 32 MiB、4000 万像素。超过边界时压缩素材或拆分演示，不绕过保护。
- Office 依赖和运行环境由宿主配置。报告缺失依赖，不自行安装、升级或更换宿主运行时。
- 新规格的 `theme` 只允许 `modern-clean`、`academic-editorial`、`digital-tech`、`warm-education`、`ecnu-liwa`。旧 `profile` 仅用于兼容已有规格，不能和 `theme` 同时出现。
- `ecnu-liwa` 不改写品牌配色、背景和校标；其他主题不得偷偷加入 ECNU 校徽、学校名称或背景资产。
- 每套主题保持一致的排版、信息层级和节奏。同一份 PPTX 不逐页混用主题；需要另一种方向时生成一个新版本供比较。
- 字体名称固定为常见中文无衬线体；设备缺少字体时 PowerPoint/WPS 可能替换，必须通过真实渲染复核关键交付件。

## 讲者备注与外部文件

每个 slide 可包含 `speaker_notes`，完整写入 PowerPoint 备注，不显示在页面上。标题、列标题、指标标签、时间标签和备注缺少时可以省略；只有真实数值才使用 metrics，不补造数值或标签。每页需要实际可显示内容，不能只剩空白或备注。`summary` 版式适用于资料概览，条目较多时由共享排版继续呈现。模板标记与叙事比例属于质量提示，不阻断正常创建。外部文稿的标准验证检查容器和结构，不要求本组件的模板标记或学校资产；品牌主题需要宿主配置 `DSH_OFFICE_BRAND_ASSETS`。
