# 共享成果服务

[English](README_EN.md)

为应用和 DSH 对话工具提供 Office 生成与预览、TTS/ASR Provider 及媒体渲染。Studio 使用同一组组件；本包不依赖 Studio、其索引、机构登录或桌面壳。

版本为 `@eduwork/dsh-artifact-services@0.2.0`，与 Studio `0.5.0` 配套。DSH 集成目标严格为 `0.1.5-rc.1`；底层应用 API 要求 Node 22.19+ 或 24，以及所用能力的运行环境。插件的稳定版本号不代表上游 DSH 已脱离 rc。

DSH Host 须通过完整的根级 npm `overrides` 和校验过的锁文件，将直接与间接 `@deepseek-ai/dsh*` 依赖统一锁定到 `0.1.5-rc.1`。只锁顶层包可能使上游 caret peer 解析到 rc.2，与 Studio 的精确 rc.1 peer 冲突并触发 `ERESOLVE`。安装示例以此配置为前提；使用装配锁文件执行 `npm ci`，不要通过 `--force` 或 `--legacy-peer-deps` 绕过冲突。

上述 rc.1 条件适用于独立 npm 安装。EduWork 桌面使用 rc.2 Runtime 与固定插件载荷的产品组合，不在 Runtime 内重新执行本段安装命令；详见[产品构建指南](https://github.com/ecnu/EduWork/blob/main/docs/BUILD.md)。

## 安装与配置

在 Node 项目中安装精确版本 `@eduwork/dsh-artifact-services@0.2.0`。本地验证也可安装已检查的压缩包：
```sh
npm install ./eduwork-dsh-artifact-services-0.2.0.tgz
```

使用 Studio 时，在同一命令中安装配套 Studio 包，只启用 Studio bundle，由其注册一次 Shared。见[源码构建与 Profile 激活](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/docs/USAGE.md)。普通 Node 应用直接调用下述 API；DSH Host 还需加载一次 `/dsh` 适配器。

Office 要求 Python 3.12+ 与本包 `python/requirements.txt` 中的依赖，`DSH_OFFICE_PYTHON` 指向解释器绝对路径。安装 npm 包不会安装 Python 库、ASR 模型或浏览器。TTS 内置 Windows System.Speech，使用系统已安装音色；其他平台需要 Provider。端侧 ASR 要求宿主提供 whisper.cpp 可执行程序和模型，见[转写说明](docs/TRANSCRIPTION.md)。

共享预览解析真实 DOCX/XLSX/PPTX 文件，保留 PPTX 固定页面坐标并使用内容哈希元数据。控件跟随宿主主题，文档内容保留原色。Studio 与对话附件使用同一[预览契约](docs/OFFICE_PREVIEW.md)；原生全屏和普通文档预览由宿主管理，对话最终文件可用时交给官方 `present`。预览保真度仍需用原生 Office 独立核对。

PDF/视频应用可从 `@eduwork/dsh-artifact-services/runtime` 导入 `createMediaRuntime` 并使用其 `browserExecutable`。固定部署应同时提供 `DSH_MEDIA_NODE_ENV` / `DSH_MEDIA_BROWSER`，兼容旧 `ECNU_AGENT_NODE_ENV` / `ECNU_AGENT_REMOTION_BROWSER`。已配置时不调用 `ensureBrowser`；未配置时实际渲染可准备本包浏览器，只读就绪检查不会下载。

运行时锁定 Remotion 4.0.520、mediabunny 1.55.5、React/React DOM 18.3.1，各调用方应解析到同一份 mediabunny。同入口的 `getMediaFFmpegPath` 从选定依赖所属环境解析 FFmpeg，不准备浏览器；可通过 `{runtime}` 传入已有运行时。

## 应用接口（v1）
```js
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SpeechService, createSystemSpeechProvider} from '@eduwork/dsh-artifact-services/speech'
if (process.platform !== 'win32') throw new Error('This example uses Windows System.Speech')
const directory = await mkdtemp(join(tmpdir(), 'shared-speech-example-'))
const speech = new SpeechService()
const dispose = speech.register(createSystemSpeechProvider())
const system = (await speech.list()).find(provider => provider.id === 'system')
if (!system?.available || !system.voices.length) throw new Error('Install an OS voice first')
try {
  const file = await speech.synthesize({
    provider: 'system', voice: system.voices[0].id, text: 'Hello.', speed: 1,
    directory, name: 'preview-1', signal: new AbortController().signal,
  })
  console.log(file.path) // Actual WAV; measured duration is also returned.
} finally { dispose() }
```

完整示例分别保存为 `.mjs`，在已安装本包的项目内运行。下列扩展示例是适配器模板，`host*`、工作区、执行上下文和取消信号由宿主提供。所有语音 Provider 使用统一的 `voices()` 与 `synthesize(request)`：
```js
speech.register({
  id: 'my-tts', title: 'My speech service', local: false,
  voices: async () => [{id: 'narrator', title: 'Narrator', language: 'zh-CN'}],
  async synthesize({text, voice, speed, directory, name, signal, execution}) {
    // Obtain credentials/permission through your host adapter. Use the exact
    // text, observe cancellation, save a real WAV in an authorized location.
    return hostSpeechAdapter.synthesize({text, voice, speed, directory, name, signal, execution})
  },
})
```

`execution` 是可选、短期有效的宿主上下文，不得序列化或发给浏览器。音色与 Provider 错误直接返回，不自动改用其他音色、本机引擎或厂商。时长从实际 WAV 字节测量，不采信厂商估计。当前 Provider 边界要求 WAV，其他原生格式由适配器转换；字幕按实际合成片段同步，不承诺逐词时间戳。

DSH 扩展通过 `ctx.artifactServices.registerSpeechProvider(provider)` 使用同一注册表，Studio 与 `speech_synthesize` 都从这里调用。HTTP、凭据、机构音色目录属于 Provider 适配器，`speech_synthesize` 是共享工具权限边界。直接调用 Provider 的应用必须保留宿主执行上下文和权限策略。

图像生成采用相同分层：
```js
import {ImageService} from '@eduwork/dsh-artifact-services/images'
const images = new ImageService()
const unregister = images.register({
  id: 'my-images', title: 'My image service', local: false,
  available: async () => hostImageAdapter.isConfigured(),
  capabilities: {nativeSizes: ['1024x1024'], customSize: true,
    fitModes: ['crop', 'pad'], formats: ['image/png']},
  generate: request => hostImageAdapter.generate(request),
})
const catalog = await images.list()
const image = await images.generate({provider: 'my-images', prompt: 'A landscape illustration',
  size: '1920x1080', fit: 'pad', projectPath: workspaceDirectory, signal, execution})
unregister()
```

Provider 接收 `prompt`、可选 `size`/`fit`、绝对 `projectPath`、短期 `execution`、`sessionId` 和 `signal`，返回真实工作区 PNG/JPEG/WebP/GIF/AVIF 的绝对 `path`；可附带 `mime`、`size`、`requestedSize`、`generationSize`、`sourceRelativePath`、`sourceSize`、`resized`、`resizeWarning`。

服务校验文件签名与工作区边界，规范化公开结果并移除其他字段；凭据留在宿主。原生尺寸选择和缩放由选定 Provider 负责，共享服务不强制某家厂商的尺寸列表。缩放失败应保留原图，报告实际尺寸与警告。

`images.list()` 返回 `{id,title,local,available,capabilities}`。没有可用 Provider 时报错，多个可用时要求明确选择，不自动回退。DSH 使用 `ctx.artifactServices.registerImageProvider(provider)`；注册/注销触发 `artifact-services/images-changed`，凭据或配置变化后适配器调用 `ctx.artifactServices.refreshImageProviders()`，更新内置 `artifact-images` 技能可用性。采用 `{skills:false}` 的装配须自行维护相应能力过滤。
```js
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {runOffice, normalizeOfficeRequest} from '@eduwork/dsh-artifact-services/office'
if (!process.env.DSH_OFFICE_PYTHON) throw new Error('Configure the Python runtime first')
const projectPath = await mkdtemp(join(tmpdir(), 'shared-office-example-'))
const result = await runOffice({projectPath, signal: new AbortController().signal,
  environment: process.env,
  request: normalizeOfficeRequest('document', {
    action: 'create', output_path: 'report.docx',
    spec: {blocks:[{type:'paragraph',text:'Hello.'}]},
  }),
})
console.log(projectPath, result)
```

Office 支持文档和电子表格编辑、检查/验证、演示文稿布局、PDF 创建/合并/提取及 HTML 预览。演示文稿接受 `speaker_notes`；表格创建/编辑/追加支持 `{type:'text',value:'=literal'}` 与 `{type:'formula',value:'=SUM(A1:A2)'}`。普通字符串保留已有公式行为；公式验证不计算数值。`renderOfficePreview()` 提供有界结构化 HTML 预览，并非像素级 Office 渲染。

通过 `DSH_OFFICE_PYTHON` 指定已安装 `python/requirements.txt` 的解释器，仍接受旧 `CHATECNU_WORK_OFFICE_PYTHON`。隔离解释器运行本包内的 Python 源码，不运行另外维护的已安装 `ecnu_agent_*` 脚本。依赖准备是显式部署步骤，生成请求不会安装软件；机构素材可用 `DSH_OFFICE_BRAND_ASSETS` 注入，本包不内置。
```js
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {renderMedia} from '@eduwork/dsh-artifact-services/media'
import {createMediaProviders} from '@eduwork/dsh-artifact-services/providers'
import {loadMusicCatalog} from '@eduwork/dsh-artifact-services/music'
const directory = await mkdtemp(join(tmpdir(), 'shared-video-example-'))
const providers = createMediaProviders()
const disposeMusic = await loadMusicCatalog(providers)
try {
  const file = await renderMedia({id:'overview',kind:'video',title:'Overview',
    segments:[{heading:'One idea',bullets:['A short point'],narration:''}],
    options:{narration:false,subtitles:false,sceneSeconds:3,aspect:'16:9',bgm:'quiet-explanation'},
  }, directory, new AbortController().signal, console.log, providers)
  console.log(file.path) // A real MP4 with BGM, without narration or subtitles.
} finally { disposeMusic() }
```

结构化音视频与可编辑 Remotion 项目使用 `lib/remotion.js`。可编辑运行器保留源码编辑、暂存、完整性绑定的语音任务、完整验证、封面和质量检查帧。`runVideoCommand(command, options, runtime)` 是调用入口；`createMediaRuntime()` 解析组件自身依赖，也可注入校验过的托管运行时。旧 CLI 环境检查仍为兼容启动器保留。

## DSH 装配

只加载一次 `@eduwork/dsh-artifact-services/dsh`。它提供 `artifactServices`、六个通用技能，以及启用且可用时的 `artifact-images`；默认十个工具，另有两个可选图像工具：

| 工具 | 职责 |
| --- | --- |
| `office_document`、`office_spreadsheet`、`office_presentation`、`office_pdf` | Office 操作，使用工作区相对路径 |
| `speech_voices`、`speech_synthesize` | Provider、音色、配乐发现及语音合成 |
| `image_providers`、`image_generate` | 配置 `images.enabled:true` 后提供图像发现/生成 |
| `speech_transcription_providers`、`speech_transcribe` | 音频文件转写服务发现和转写 |
| `media_render` | 结构化音视频生成 |
| `video_project` | 可编辑项目初始化、暂存、语音任务、验证与渲染 |

不要同时注册旧 `tool-office`。权限、凭据和成果发布留在 DSH；工具将取消信号和原始执行上下文传给嵌套厂商工具。`{skills:false}` 允许产品自行管理通用技能；`{bgmRoot}` 可选择其他校验过的目录，默认使用随包六首配乐。

## 素材、构建与兼容性

- 六首器乐配乐包含乐谱 JSON、确定性合成代码、192 kbps MP3 以及哈希、音量、循环元数据，见[配乐使用与许可](media/BGM-USAGE.md)。
- `templates/structured` 是结构化视频源码，`templates/editable` 是可修改起始项目；它们共用渲染器。
- 不含第三方音频采样或机构 Logo。Remotion 遵循自身许可证。
- Office 能力限定于已支持的 OOXML/PDF 特性，不支持宏、修订记录、动画编辑或公式计算。
- 测试需配置 Python；父仓覆盖 Office 编辑/预览/验证、Provider 契约、配乐完整性、视频运行器与浏览器检查。

## 图像与平台配置

DSH 服务默认关闭生图。部署方须在 ArtifactServices 插件配置中显式设置 `images: { enabled: true }`，统一开启工具、技能与 Provider 调用。Office 和视频中的本地图片不受影响，语音与视频能力也独立于此选项。

内置系统 TTS 支持 Windows。其他平台需要注册语音 Provider 并提供兼容的原生资源，见[平台要求](docs/PLATFORMS.md)。
