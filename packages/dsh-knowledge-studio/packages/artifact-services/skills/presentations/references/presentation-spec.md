# 演示文稿 JSON 规格

新建规格使用顶层 `theme`，默认值为 `modern-clean`。支持：`modern-clean`、`academic-editorial`、`digital-tech`、`warm-education`、`ecnu-liwa`。旧顶层 `profile`（`liwa-modern`、`academic-editorial`、`digital-campus`）仅用于兼容历史规格；`theme` 与 `profile` 互斥。

## 顶层

```json
{
  "theme": "modern-clean",
  "metadata": {
    "title": "年度项目工作汇报",
    "author": "项目团队",
    "subject": "项目汇报",
    "language": "zh-CN"
  },
  "footer": "项目团队",
  "slides": []
}
```

- `slides` 必填，1–40 个语义内容页。空间不足时文件可以自动续页；使用返回的 `slide_count` 和 `source_pages` 报告实际文件页数。
- `theme` 可选，省略时使用 `modern-clean`。未知值会报 `unsupported_theme`，不会静默回退。`profile` 仅用于历史兼容。
- `metadata`、`footer` 可选。所有未声明字段都会被拒绝，用于防止模型写错键名后静默丢失内容。
- 所有文本必须是字符串；不支持 Markdown 或 HTML。
- 不存在颜色、坐标、字体、背景或校标覆盖字段；通用主题由脚本统一控制视觉系统。仅 `ecnu-liwa`（以及历史 `profile`）使用外部注入的机构素材，本包不提供这些图片。详见 [品牌素材配置](brand-assets.md)。

先根据受众从 [profile-library.md](profile-library.md) 的选择表挑选 theme，再组合下面的固定版式。

## 版式

### 封面 `cover`

```json
{"layout":"cover","title":"让项目成果进入日常工作","subtitle":"年度工作汇报","meta":"项目团队 · 示例"}
```

### 章节页 `section`

```json
{"layout":"section","number":"01","title":"从场景出发","subtitle":"把需求收敛成可验证的任务"}
```

### 要点页 `bullets`

`bullets` 建议每页 4–6 条。可以直接写字符串，也可以用对象标记二级要点或强调项。条数、单条字数和总字数不作为正常内容的拒绝理由；超过模板可读空间时自动换行或续页，保留完整文字。

```json
{
  "layout":"bullets",
  "title":"今年完成了什么",
  "kicker":"01 进展",
  "bullets":[
    {"text":"完成统一 Agent 入口","accent":true},
    {"text":"为教师和学生提供开箱即用的工具","level":1}
  ],
  "note":"所有能力均在当前项目权限内运行"
}
```

### 双栏页 `two-column`

可见内容使用 `title`、`left` 和 `right`，补充说明放在相应栏的 `bullets`；本版式没有独立可见 `note` 字段。仅供讲述、不需显示在页面上的内容才放通用 `speaker_notes`，不要因此丢弃用户要求显示的说明。

```json
{
  "layout":"two-column",
  "title":"两条路径同时推进",
  "left":{"heading":"产品","bullets":["简化配置","改善交互"]},
  "right":{"heading":"治理","bullets":["隔离凭据","保留审计"]}
}
```

### 指标页 `metrics`

`metrics` 建议 2–4 项，至少一项；`value` 和 `label` 必填，`detail` 可选。`value` 使用单行文字，完整保留数值及空格，例如 `75% → 85%`、`3.6 → 4.1`。常规卡片按真实列宽选择字号；仍放不下时自动改用更宽的内容区域或续页，不强行缩到不可读字号，不截断数值。Studio 与共享生成器的数值输入使用同一份契约的 24 字符校验；详细解释应放 `detail`。

```json
{
  "layout":"metrics",
  "title":"关键结果",
  "metrics":[
    {"value":"4","label":"内置办公技能","detail":"PPTX / DOCX / XLSX / PDF"},
    {"value":"100%","label":"私有运行环境","detail":"不污染宿主配置"}
  ]
}
```

### 时间线 `timeline`

用于版本演进、事件顺序和阶段里程碑。建议 3–5 个事件；按材料实际数量填写，空间不足时自动续页。

```json
{
  "layout":"timeline",
  "title":"三次关键跨越",
  "events":[
    {"period":"2026-01","title":"统一工具入口","detail":"收敛分散的智能体能力"},
    {"period":"2026-04","title":"重构多轮思考","detail":"提升复杂任务连续执行能力"},
    {"period":"2026-07","title":"接入校园数据","detail":"在授权边界内连接真实场景"}
  ]
}
```

### 能力矩阵 `feature-grid`

用于能力地图、产品组成和主题分类。建议 3–6 项；脚本按空间选择网格或可读续页，不允许提交颜色和坐标。

```json
{
  "layout":"feature-grid",
  "title":"能力不再分散",
  "items":[
    {"title":"内容创作","detail":"文档、演示和表格在同一任务中完成"},
    {"title":"校园咨询","detail":"把经过治理的校园知识接入工作流"},
    {"title":"复杂执行","detail":"在受控环境中持续完成多步骤任务"},
    {"title":"多模态生成","detail":"图像、语音和视频形成统一能力入口"}
  ]
}
```

### 路线图 `roadmap`

用于下一步计划和实施阶段。建议填写 3–5 个阶段；每项同时给出阶段、行动标题和简短结果。栏数越多，行动标题宜越简练：3 栏最多约 24 个中文显示单位，4 栏最多 18 个，5 栏最多 14 个；英文半角字符约按 0.55 个单位计算。不要靠缩小字号塞入长标题。

```json
{
  "layout":"roadmap",
  "title":"下一阶段怎么走",
  "stages":[
    {"stage":"近期","title":"统一身份与权限","detail":"形成可审计的登录和授权协议"},
    {"stage":"中期","title":"完善模型路由","detail":"按任务自动选择适合的模型"},
    {"stage":"持续","title":"建设技能生态","detail":"支持院系沉淀自己的工作流"}
  ]
}
```

### 图片页 `image`

`image` 必须是当前项目内现有 PNG/JPEG/WebP 文件的绝对路径。脚本会按比例居中适配，不拉伸图片。

```json
{"layout":"image","title":"界面原型","image":"/absolute/path/to/project/assets/prototype.png","caption":"通用主题示例","source":"项目内已有图片"}
```

### 引语页 `quote`

```json
{"layout":"quote","quote":"把复杂的配置留给系统，把清晰的任务留给用户。","attribution":"示例设计原则"}
```

### 结束页 `closing`

```json
{"layout":"closing","title":"谢谢","subtitle":"欢迎交流","contact":"https://example.org"}
```

## 建议叙事顺序

优先使用“封面 → 问题/背景 → 方案 → 证据/指标 → 下一步 → 结束”。不要为了页数堆叠重复要点。一页要点过多时拆成两页，不要缩小到难以阅读。

## 长稿规划建议

12 页及以上可默认参考：

- `timeline`、`feature-grid`、`roadmap`、`image` 合计至少 2 页；
- 章节页约每 5 页不超过 1 张；
- `bullets` 不超过内容页 40%；
- 16 页及以上尽量使用至少 5 种内容版式；
- 同一版式尽量不要连续超过 2 页。

这些是叙事与设计建议，不是 PPTX 有效性规则。内容确有需要时可以偏离；Agent 应先判断实际故事线，能改进时自动调整计划，不因比例不满足而拒绝创建。

默认验证只阻断结构、安全与确定性排版错误，包括损坏容器、缺少必需资产、对象越界和可确定的文本溢出。配色、字号、版式重复、章节/Bullet/视觉页比例进入 `quality_warnings`，不影响默认 `valid` 或退出码。`--strict` 仅供 CI 和内置模板回归，把这些告警升级为失败，不用于普通用户任务。
