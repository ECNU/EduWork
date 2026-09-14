# 视频规格 v2

`video-plan.json` 是 UTF-8 JSON，不允许注释。新工程使用 `version: 2`。runner 会把源计划、受管配音绑定和音频真实时长解析成帧级渲染计划，Remotion 不再自行估算配音时间。

## 最小无配音示例

```json
{
  "version": 2,
  "id": "project-intro",
  "title": "一分钟认识这个项目",
  "template": "digital-pulse",
  "aspectRatio": "16:9",
  "fps": 30,
  "scenes": [
    {
      "id": "opening",
      "layout": "hero",
      "durationSeconds": 4,
      "eyebrow": "项目介绍",
      "title": "从一个清晰的想法开始",
      "body": "用简短的内容说明目标、方法和成果。"
    }
  ],
  "audio": {"bgm": null}
}
```

## 计划字段

- `version`：新项目固定为 `2`。runner 仍能读取旧的 `version: 1` 工程，但不要再新建 v1。
- `id`：产物 slug，只用小写字母、数字和连字符，1-63 个字符。
- `title`：作品标题，最多 120 个字符。
- `template`：`editorial`、`archive-paper` 或 `digital-pulse`。详见 [templates.md](templates.md)。
- `aspectRatio`：`16:9`、`9:16` 或 `1:1`，对应 `1920x1080`、`1080x1920`、`1080x1080`。
- `fps`：默认 `30`，也可用 `24` 或 `25`。
- `coverFrame`：可选封面帧索引；省略时取首个可读时刻附近。
- `targetDurationSeconds`：可选，3-600 秒。用户明确提出时长时填写。
- `durationToleranceSeconds`：可选，默认是目标时长的 5% 且至少 1 秒。解析后的真实时长超出容差会返回 `target_duration_mismatch`。
- `theme`：可选的四个 `#RRGGBB` 覆盖色：`background`、`foreground`、`accent`、`muted`。通常直接使用模板默认值，不让弱模型随意配色。
- `scenes`：1-30 个场景，解析后总时长不超过 10 分钟。

## 场景字段

```json
{
  "id": "feature-one",
  "layout": "split",
  "eyebrow": "核心能力",
  "title": "一个镜头，一个主要意思",
  "body": "用简短说明支撑标题。",
  "media": {
    "type": "image",
    "src": "assets/project.jpg",
    "fit": "cover",
    "alt": "项目展示图片"
  },
  "narration": "这段文字先作为字幕定稿，再原样交给语音合成。"
}
```

- `id`：计划内唯一 slug。
- `layout`：受限布局枚举；具体字段要求见 [templates.md](templates.md)。
- `eyebrow`：可选短标签，最多 24 个字符。
- `title`：必填，最多 48 个字符；推荐不超过 32 个中文字符。
- `body`：可选，最多 100 个字符；它是画面支撑文案，不是字幕。
- `bullets`：`list` / `timeline` 使用，2-4 项，每项最多 40 个字符。
- `stat`：`stat` 使用，形如 `{"value":"75%","label":"事务可在线办理"}`。
- `media`：本地图片。`split` / `full-media` 必须提供；`src` 是工作区 `public/` 下的相对路径，`fit` 为 `cover` 或 `contain`。
- `narration`：可选，既是该镜头整段显示的字幕，也是 TTS 精确输入，硬上限 42 个字符；推荐 12-36 个字符，`9:16` 推荐不超过 30 个字符。当前不是逐词时间码字幕，长内容必须按语义拆成多个场景。
- `durationSeconds`：只有无 `narration` 的场景填写，1-30 秒。有配音的场景写此字段会被拒绝。

## 配音配置与确定性绑定

```json
{
  "voiceover": {
    "voice": "<speech_voices 返回的音色 ID>",
    "format": "wav",
    "speed": 1,
    "leadInSeconds": 0.18,
    "tailSeconds": 0.45,
    "showCaptions": true
  }
}
```

- `voice`：先调用 `speech_voices`，从可用提供方的实时目录选择音色，将示例占位符替换为实际 ID。不同宿主和操作系统的音色不同，不依赖任何机构目录。已有偏好足够时直接采用；需要选择时仅向用户展示实际可用音色。
- `provider` 不属于 `video-plan.json` 的 `voiceover` 字段；在每次 `speech_synthesize` 调用中传入所选提供方 ID，并保持整个项目的提供方选择一致。切换提供方后重新生成并绑定受影响的配音，不能仅凭相同音色 ID 复用旧音频。
- `format`：通过公共 `speech_synthesize` 工具生成时必须显式写 `wav`，该工具固定返回 WAV，不接受格式参数。读取历史或外部配音工程时 runner 也支持 `mp3`、`opus`、`aac`、`flac`；计划格式必须与真实音频容器一致，不使用原始 `pcm`。
- `speed`：`0.25`-`4.0`，默认 `1.0`。
- `leadInSeconds`：每个配音场景开始到人声开始的停顿，默认 `0.18` 秒，范围 0-2 秒。
- `tailSeconds`：每段人声结束后的画面收尾，默认 `0.45` 秒，范围 0.2-3 秒。
- `showCaptions`：默认 `true`。只有用户明确要求无字幕时才关闭。

目标时长只能在真实音频生成后最终确认，但可以在合成前减少返工。若共有 `N` 个配音场景，先估算：

```text
可用人声秒数 = targetDurationSeconds - N × (leadInSeconds + tailSeconds)
建议总字数 ≈ 可用人声秒数 × 3.5 至 4.5
```

第一次 `validate` 仍以实际音频为准。若超出容差，扣除固定余量后按“目标人声时长 ÷ 当前人声时长”调整各场字幕，只重新合成文字发生变化的场景。改变全局 `speed` 会让全部任务哈希失效。

`voiceover-jobs` 为每个场景输出由以下内容组成的 SHA-256 任务身份：

```text
sceneId + narration + voice + format + speed
```

先调用 `video_project`，提供 `action:"voiceover-jobs"` 和 `workspace`，读取未就绪任务。逐段调用 `speech_synthesize`，把任务的 `text`、`voice`、`speed` 原样传入，并提供所选 `provider`。使用返回的 `reportJSON.path` 绝对路径；若使用 `relativePath`，先以当前项目根解析为绝对路径。然后调用：

```json
{
  "action": "stage-voiceover",
  "workspace": "<init 返回的 workspace>",
  "scene-id": "<任务 sceneId>",
  "job-hash": "<任务 jobHash>",
  "input": "<speech_synthesize 返回的绝对路径>"
}
```

上述参数交给 `video_project` 工具；宿主负责项目根和运行时，不查找内部 CLI 脚本。`stage-voiceover` 只接受当前项目内的 TTS 文件，并把它复制到 runner 决定的 `public/audio/narration/` 路径。`jobHash` 必须仍与当前字幕、音色、格式和语速一致；计划在生成与绑定之间发生变化时会拒绝旧音频。绑定状态放在工作区私有 `.voiceover-bindings/`，不要手工编写或修改。`validate` 和 `render` 都会重新校验任务哈希、文件 SHA-256、音轨可读性和真实时长，不能信任旧的缓存秒数。

帧数规则：

```text
audioFrames = ceil(realAudioSeconds × fps)
sceneFrames = round(leadInSeconds × fps) + audioFrames + ceil(tailSeconds × fps)
```

所有场景按计划顺序累计。音频和字幕使用同一个帧窗口，BGM 只在这些真实人声帧内 ducking。

## BGM

```json
{
  "audio": {
    "bgm": {
      "src": "audio/background.mp3",
      "volume": 0.16,
      "duckVolume": 0.06
    }
  }
}
```

BGM 从第 0 帧循环到视频结束，首尾自动淡入淡出。`src` 只允许 `public/` 下的相对路径。用 `speech_voices` 查看曲库，然后调用 `video_project` 的 `stage-bgm` 动作，提供 `workspace` 和 `track-id`。项目内已授权音频用 `stage` 导入，例如调用 `video_project`：

```json
{
  "action": "stage",
  "workspace": "<init 返回的 workspace>",
  "input": "<项目内 BGM 的绝对路径>",
  "destination": "audio/custom-bgm.mp3"
}
```

## 素材路径

`video_project` 的 `stage` 动作中，`input` 必须是当前项目内普通文件的绝对路径，`destination` 是工作区 `public/` 下的相对路径；图片使用 `assets/photo.jpg`，音频使用 `audio/custom-bgm.mp3`，扩展名必须匹配实际文件。不覆盖已有文件。`video-plan.json` 的素材引用不使用绝对路径、`..`、`file:` 或 HTTP URL。
