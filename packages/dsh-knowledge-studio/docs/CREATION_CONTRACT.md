# 对话与 Studio 的共同创作契约

内容规范唯一来源为 Shared 的 `skills/shared/references/`。此目录没有技能入口，不增加能力卡。对话创作技能链接相应参考；Studio 经 `readCreationGuidance(kind, {signal})` 将同一文件加入生成请求。演示继续读取既有 presentation-spec 和 profile-library。修改通用内容规则应改这些参考，Studio 提示仅适配请求参数和 JSON 字段。

集中装配技能时保留完整 Shared skills 目录及相对参考的资源基址，不能只复制单个 SKILL.md。Studio 技能仅处理明确请求的 Studio 成果组织、同轮修订、最终版本和下载；普通创作由对应技能接管。技能中心的别名合并与可见卡片由宿主负责。

| 能力 | 对话入口 | Studio 适配 | 共同实现 |
| --- | --- | --- | --- |
| Office | office_document / office_spreadsheet / office_presentation | officeSpec 转换，governed Office 操作或导出 | runOffice、规范化请求、同一 Python 文件组件 |
| Office 预览 | 宿主 artifact-preview-native 与媒体成果 UI | ArtifactEngine.export(preview) 与 Studio UI | renderOfficePreview 与 mountOfficePreview，读取实际文件 |
| 语音 | speech_synthesize | 媒体生成适配 | 同一 SpeechService、提供方和音色目录 |
| 结构化音视频 | media_render | studio-media 转换 scenes/segments | renderMedia、时间轴、字幕、混音和渲染模板 |
| 可编辑视频工程 | video_project | 当前无对应 Studio 源码编辑界面 | Shared runner 和语音服务；共同内容规范 |

一致性指规范、服务契约和真实文件的展示一致，不保证随机模型输出逐字相同。Studio 的资料整理表目前使用文本单元格；公式、类型化计算模型和复杂现有文档编辑使用对话 Office 工具。结构化视频与可编辑 Remotion 工程的布局能力不同，不能承诺无损互转。

Office 预览不重新按草稿生成文件，媒体播放指向实际 WAV/MP4。结构检查、浏览器预览和原生视觉验收分别报告。共同规范不把结构检查提升成视觉保证，也不把未试听的媒体称为已听验。

回归包括五类实际 Studio 模型请求中的同源规范注入（合成模型边界，无外部调用）、既有 Office 文件与实际预览测试、共享媒体服务测试。宿主装配需另检查技能相对参考可读取、能力卡无重复及同一文件两入口预览。
