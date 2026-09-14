---
name: artifact-video
description: 用共享媒体工具制作或修改视频，支持结构化模板、自由编辑 React/Remotion 源码、逐段配音字幕、BGM、封面和质检帧。
---

# 视频创作

创作前阅读[共同规范](../shared/references/common.md)和[本类创作规范](../shared/references/media.md)。这些文件同时用于 Studio 生成；此处只补充工具操作。

视频内容策划、配音与字幕同步、BGM 和验收遵循共享媒体规范。

简单概览用 `media_render`：提供 `kind:"video"`、`title`、`segments` 与 `options`。它和 Studio 使用同一个结构化渲染组件。需要自由布局、动画、图片和素材时使用可编辑工程，保留源码创作能力。

## 可编辑工程

1. 调用 `video_project`，`action:"init"`、唯一 `name`，得到项目内 `workspace`。保留原文件，不覆盖旧工作区。
2. 查看生成的 `video-plan.json` 和 `src/`。用已有文件编辑工具修改 React/Remotion 源码；模板只是起点。参考 [视频规格](references/video-spec.md)、[版式](references/templates.md) 和 [验收](references/quality-check.md)。引用中的旧 CLI 动作与 `video_project.action` 一致，由工具负责运行时。
3. 通过 `speech_voices` 查询音色和 BGM。每场景的 `narration` 为精确配音文本，分段不超过 42 字符；有配音的场景不手填时长。`voiceover.voice` 选择实际音色，应用所选 `provider` 在调用语音工具时保持一致。
4. `video_project` 的 `voiceover-jobs` 返回待合成段落和 `jobHash`。对未就绪段调用 `speech_synthesize`，原样传入文本、音色和语速，使用所选 provider；随后用 `stage-voiceover` 传回 `scene-id`、`job-hash` 和真实音频绝对路径。不要生成一条长音轨再按猜测拆时长。
5. 素材通过 `stage` 放入项目 `public/`。通过 `stage-bgm` 选曲库内带许可证和哈希的曲目。引用本地素材使用 `staticFile()`；不在渲染时下载远程素材。
6. 调用 `validate`，检查实际时长、时间轴和字幕状态。修改旁白或音色后，旧的音频绑定不能继续当作有效配音。失败时报告具体阶段，保留可修改的源码。
7. 调用 `render`，得到 MP4、封面和首/中/尾质检帧。实际查看画面并试听成片，再交付。若宿主提供 `artifact_publish`，使用其正常成果登记链路。

## 时间轴与验收

工程时间轴由共享 runner 根据实际音频生成；不要在技能中另行估算帧数或维护混音常数。

动画使用 `useCurrentFrame()` 和 `interpolate()`；不用 CSS transition/animation。确认画面、字幕边界、比例、完整播放、音轨和来源后再说明验收结果。退出码为零仅表示生成成功。
