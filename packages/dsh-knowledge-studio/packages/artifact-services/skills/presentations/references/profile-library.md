# 演示文稿主题库

新建演示文稿使用顶层 `theme`。主题决定色彩、品牌资产和基础排版语气，语义布局仍由每页 `layout` 决定。旧顶层 `profile` 只保留给已有规格兼容，不能和 `theme` 同时使用。

| theme | 首选场景 | 视觉方向 |
|---|---|---|
| `modern-clean`（默认） | 通用汇报、年度复盘、方案与产品介绍 | 蓝灰锚点、大留白、清晰层级 |
| `academic-editorial` | 论文、研究汇报、学术讲座 | 暖灰与铁锈色、非对称编辑网格 |
| `digital-tech` | 科技发布、数据产品、数字能力展示 | 青蓝信号色、冷灰数据分区 |
| `warm-education` | 课程、教育主题、人物与校园活动 | 暖橙与柔和绿色、亲和编辑节奏 |
| `ecnu-liwa` | 用户明确要求 ECNU 品牌，且宿主已注入素材 | 外部提供的品牌背景、标志与固定品牌锚点 |

拿不准时选 `modern-clean`。不能仅因主题含 AI、数据就选 `digital-tech`；也不能仅因宿主属于某个机构就自动选择品牌主题。品牌素材不随包提供，配置见 [brand-assets.md](brand-assets.md)。

## 旧 Profile 兼容

下表解释历史 `profile`，仅供已有规格重建和兼容回归使用。它们保持原有 ECNU 品牌行为，需要宿主注入素材；新任务不要再生成这些字段。

### 历史布局映射

| profile | 首选场景 | 视觉与信息结构 | 避免使用 |
|---|---|---|---|
| `liwa-modern` | 历史汇报、年度复盘、产品介绍 | 大留白、横向标题、浅色分区、中心大图；阅读路径最直接 | 需要强学术叙事时 |
| `academic-editorial` | 学术讲座、研究汇报、课题叙事 | 非对称编辑网格、章节编号栏、内容侧栏、指标行、图片+图注纵栏 | 高频经营指标或科技展板式汇报 |
| `digital-campus` | 用户明确要求科技展陈、发布会或数字信号感的短稿 | 白色主画布、红色信号线、冷灰数据分区和少量深蓝标记 | 长篇年度复盘、正式校务汇报；不能仅因主题含 AI/数据而选择 |

重建时保持原稿的 `profile`，不逐页混用。新建通用汇报使用 `theme: modern-clean`；主题包含数字化或数据，不代表需要历史 `digital-campus` 品牌布局。

### 历史布局的结构差异

| 页面 | liwa-modern | academic-editorial | digital-campus |
|---|---|---|---|
| 封面 | 左对齐标题、大留白 | 红色竖栏+右侧标题，像期刊扉页 | 白底标题+红色竖向信号线+小型数据标记 |
| 章节 | 大号章节号+横线 | 独立编号栏+右侧章节叙事 | 大号红色编号+开放白底+短信号线 |
| 要点/双栏 | 浅色卡片或开放列表 | 左标题栏+右正文，或细线分栏 | 白底开放列表或冷灰浅分区，不使用深色面板 |
| 指标 | 独立浅色指标卡 | 横向编辑式指标行 | 冷灰浅色数据分区+红色主指标 |
| 时间线/路线图 | 开放横向阅读 | 编辑式纵向阅读 | 红色节点+冷灰信号轨道 |
| 图片 | 居中大图+底部图注 | 左主图+右图注/来源纵栏 | 左侧浅灰洞察区+右侧主图 |
| 引语 | 大引号+开放留白 | 左引号栏+右侧编辑式引文 | 冷灰引号区+开放白底引文 |
| 结尾 | 横线引导的开放结束页 | 红色终章栏+右侧结语 | 白底结语+红色竖向信号线 |

## 场景配方

- 年度复盘（建议 12–16 页）：`cover → metrics → timeline → two-column → feature-grid → image/证据 → metrics → roadmap → closing`。通常把章节页控制在 3 张以内。
- 产品介绍（8–12 页）：`cover → quote/核心判断 → feature-grid → image → two-column → metrics → roadmap → closing`。
- 学术汇报（10–16 页）：`cover → section → bullets → timeline → image → two-column → quote → roadmap → closing`。

长稿可把“`bullets` 不超过内容页 40%、至少两页语义视觉版式”作为默认目标。真实内容需要更多解释页时可以偏离；Agent 应优先调整叙事和版式，而不是把比例告警解释成文件失败。没有真实图片时优先使用 `timeline`、`feature-grid` 或 `roadmap`，避免用深色大矩形代替视觉内容。

## 可复制 JSON

### 通用汇报：modern-clean

```json
{
  "theme": "modern-clean",
  "metadata": {"title": "年度工作汇报", "author": "项目团队"},
  "footer": "项目团队",
  "slides": [
    {"layout": "cover", "title": "让项目成果进入日常工作", "subtitle": "年度工作汇报", "meta": "项目团队 · 示例"},
    {"layout": "section", "number": "01", "title": "从场景出发", "subtitle": "把需求收敛成可验证的任务"},
    {
      "layout": "bullets",
      "title": "本轮完成",
      "kicker": "进展",
      "bullets": [
        {"text": "完成统一 Agent 入口", "accent": true},
        "形成开箱即用的办公能力",
        {"text": "保留项目隔离和审计边界", "level": 1}
      ]
    },
    {
      "layout": "metrics",
      "title": "关键结果",
      "metrics": [
        {"value": "4", "label": "办公技能", "detail": "PPTX / DOCX / XLSX / PDF"},
        {"value": "100%", "label": "私有环境", "detail": "不污染宿主配置"}
      ]
    },
    {"layout": "closing", "title": "谢谢", "subtitle": "欢迎交流"}
  ]
}
```

### 学术叙事：academic-editorial

```json
{
  "theme": "academic-editorial",
  "metadata": {"title": "智能体研究与实践", "author": "项目团队"},
  "footer": "项目团队",
  "slides": [
    {"layout": "cover", "title": "高校智能体研究与实践", "subtitle": "从技术可用到治理可信", "meta": "专题讲座 · 2026"},
    {"layout": "section", "number": "01", "title": "研究问题", "subtitle": "为什么通用 Agent 难以直接进入校园工作流"},
    {
      "layout": "two-column",
      "title": "研究框架",
      "left": {"heading": "技术路径", "bullets": ["运行时隔离", "工具协议", "上下文治理"]},
      "right": {"heading": "治理路径", "bullets": ["权限边界", "过程审计", "责任确认"]}
    },
    {
      "layout": "quote",
      "quote": "把复杂的配置留给系统，把清晰的任务留给用户。",
      "attribution": "示例设计原则"
    },
    {"layout": "closing", "title": "谢谢", "subtitle": "问题与讨论"}
  ]
}
```

### 数字化汇报：digital-tech

```json
{
  "theme": "digital-tech",
  "metadata": {"title": "数字化项目运行报告", "author": "项目团队"},
  "footer": "项目团队",
  "slides": [
    {"layout": "cover", "title": "校园数字化运行报告", "subtitle": "数据、平台与智能体协同", "meta": "数字校园专题 · 2026"},
    {"layout": "section", "number": "01", "title": "运行态势", "subtitle": "用同一套指标观察服务、数据和智能能力"},
    {
      "layout": "timeline",
      "title": "能力演进",
      "events": [
        {"period": "Q1", "title": "统一入口", "detail": "收敛分散的智能体场景"},
        {"period": "Q2", "title": "数据接入", "detail": "在授权边界内连接校园数据"},
        {"period": "Q3", "title": "技能中心", "detail": "沉淀可复用的办公能力"}
      ]
    },
    {
      "layout": "roadmap",
      "title": "下一阶段",
      "stages": [
        {"stage": "近期", "title": "统一身份与权限", "detail": "形成可审计的登录和授权协议"},
        {"stage": "中期", "title": "完善模型路由", "detail": "按任务选择文本、多模态与生成模型"},
        {"stage": "持续", "title": "共创技能生态", "detail": "让院系沉淀自己的工作流"}
      ]
    },
    {"layout": "closing", "title": "持续进化", "subtitle": "让数字能力自然进入每一次工作"}
  ]
}
```

图片页只需把 `presentation-spec.md` 中 `image` 版式插入对应故事位置。`image` 必须替换为当前项目内图片的绝对路径；不要把示例路径原样提交。
