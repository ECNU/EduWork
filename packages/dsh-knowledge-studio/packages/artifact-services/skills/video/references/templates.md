# 视频模板与镜头布局

`template` 只在计划级选择一次。三套模板不仅颜色不同，构图、字体语气、背景结构、媒体占比和运动方式也不同。弱模型只选择枚举并填写内容，不修改 React 样式。

## 模板

新工程使用下列中性模板。机构配色通过计划的 `theme` 四个颜色字段提供，机构名称和活动内容通过各镜头的 `eyebrow`、`title`、`body` 提供；通用模板不自动添加学校名称或标识。已有工程的 `liwa-editorial` 和 `campus-archive` 标识仍可读取，不必重写旧文件。

### `editorial`（现代编辑，默认）

- 适合：校园活动、课程介绍、新闻宣传、通用解释视频。
- 构图：暖白底、蓝色强调、非对称编辑排版、清晰留白和细线标记。
- 画面策略：标题与图片主次清楚；无图片时用 标题文字和几何构成补足画面。
- 运动：轻微上移和渐显，稳重克制。

### `archive-paper`（纸本文档）

- 适合：校史、人物、纪念、访谈摘录、年度回顾。
- 构图：象牙纸纹、酒红和墨色、衬线标题、馆藏边框与照片衬纸。
- 画面策略：年份用 `stat`，文献摘句用 `quote`，历史节点用 `timeline`。
- 运动：像翻开档案一样平缓，不使用弹跳效果。

### `digital-pulse`（数字脉冲）

- 适合：AI、数据、产品功能、技术成果、数字校园。
- 构图：明亮浅青底、粗网格、大色块、超大数字和强对比层级；不是黑底科技风。
- 画面策略：数据优先用 `stat`，功能拆解用 `list`，产品截图用 `split` 或 `full-media`。
- 运动：硬朗的线性位移和逐项错峰出现。

## 布局枚举

- `hero`：单一大标题开场或章节页；允许无图片。
- `split`：文字与本地图片分栏；必须有 `media`，竖屏会自动改为上下结构。
- `full-media`：本地图片满幅并叠加标题；必须有 `media`。
- `list`：2-4 条并列要点；必须有 `bullets`。
- `stat`：一个超大数字或年份；必须有 `stat.value` 和 `stat.label`。
- `quote`：一句引语或核心判断；必须有 `body`。
- `timeline`：2-4 个顺序节点；必须有 `bullets`。
- `end-card`：片尾结论、行动号召或署名；允许无图片。

不要连续使用三张以上同一布局。一个常用的 6 镜头节奏是：

```text
hero → split/full-media → stat → list/timeline → quote → end-card
```

## 字幕安全区

只要场景有 `narration`，模板就自动在底部预留字幕区。不要在 `body` 中重复字幕，也不要把标题或图片的关键信息压到屏幕底部。

- 字幕原文推荐 12-36 个中文字符、1-2 句，硬上限 42 个字符；竖屏推荐不超过 30 个字符。
- 横屏和方形字幕最多约两行；竖屏右侧还会给短视频平台按钮保留空间。
- 人名、校名、日期和数字必须在 TTS 前校对；TTS 后改字幕会让旧音频绑定失效。

## 有配音的计划片段

```json
{
  "version": 2,
  "id": "campus-ai-day",
  "title": "校园 AI 日",
  "template": "digital-pulse",
  "aspectRatio": "16:9",
  "fps": 30,
  "voiceover": {
    "voice": "voice-id-from-speech_voices",
    "format": "wav",
    "speed": 1,
    "leadInSeconds": 0.18,
    "tailSeconds": 0.45,
    "showCaptions": true
  },
  "scenes": [
    {
      "id": "opening",
      "layout": "hero",
      "eyebrow": "AI OPEN DAY",
      "title": "让 AI 走进校园日常",
      "body": "从一个真实问题出发。",
      "narration": "今天，我们从一个真实问题出发，看看人工智能怎样服务校园日常。"
    },
    {
      "id": "ending",
      "layout": "end-card",
      "title": "一起开始",
      "body": "让每个人都能用好 AI。",
      "narration": "让每个人都能轻松用好人工智能，我们一起开始。"
    }
  ],
  "audio": {"bgm": null}
}
```

注意：有 `narration` 的场景不能写 `durationSeconds`。先运行 `voiceover-jobs`，逐段生成并绑定音频，再让 runner 解析出真实帧数。
