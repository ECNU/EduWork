# Shared artifact services

[简体中文](README.md)

Reusable Office generation and preview, TTS/ASR providers and media rendering for applications and DSH conversation tools. Studio uses the same components. The package does not import Studio, its index, an institution login or a desktop shell.

Version: `@eduwork/dsh-artifact-services@0.2.0`, paired with Studio `0.5.0`. DSH integration targets exactly `0.1.5-rc.1`; low-level application APIs need Node 22.19+ or 24 and the relevant runtimes. This stable package version still targets an upstream DSH release candidate.

For DSH integration, the consuming host must pin every direct and transitive `@deepseek-ai/dsh*` package to `0.1.5-rc.1` through complete root-level npm `overrides` and a verified lockfile. Pinning only the top-level DSH package allows upstream caret peer ranges to resolve rc.2, which can cause `ERESOLVE` with Studio's exact rc.1 peers. The installation examples assume this host configuration. Use `npm ci` with the assembly lockfile; do not bypass conflicts with `--force` or `--legacy-peer-deps`.

The rc.1 requirement above applies to independent npm installation. EduWork desktop combines an rc.2 Runtime with pinned plugin payloads; do not rerun these install commands inside that Runtime. See the [product build guide](../../../../docs/BUILD.md).

## Install and configure

Install `@eduwork/dsh-artifact-services@0.2.0` exactly in the consuming Node project. For local acceptance, install the reviewed archive:

```sh
npm install ./eduwork-dsh-artifact-services-0.2.0.tgz
```

For Studio, install its matching archive in the same command and activate only the Studio bundle, which registers Shared once. See [source build and Profile activation](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/docs/USAGE.md). Plain Node applications import the APIs below; DSH hosts additionally load the `/dsh` adapter once.

Office requires Python 3.12+ with this package’s `python/requirements.txt`; set `DSH_OFFICE_PYTHON` to the interpreter’s absolute path. Package installation does not install Python libraries, ASR models or a browser. TTS includes Windows System.Speech using installed voices; other platforms need a provider adapter. Local ASR requires a host-provisioned whisper.cpp executable and model. See [transcription](docs/TRANSCRIPTION.md).

Shared previews read actual DOCX/XLSX/PPTX bytes, with fixed PPTX page coordinates and content-hashed metadata. Preview controls follow the host theme; document content keeps its original colors. Use the same [preview contract](docs/OFFICE_PREVIEW.md) from Studio and conversation attachments. The consuming host owns native fullscreen and ordinary document preview. Final conversation files use official `present` when available. Preview fidelity still needs independent native Office review.

PDF/video consumers in Node can import `createMediaRuntime` from `@eduwork/dsh-artifact-services/runtime` and use its `browserExecutable`. Supply `DSH_MEDIA_NODE_ENV` / `DSH_MEDIA_BROWSER` together for a pinned deployment (legacy `ECNU_AGENT_NODE_ENV` / `ECNU_AGENT_REMOTION_BROWSER` remain supported); configured deployments never call `ensureBrowser`. Without configuration, an actual rendering request may prepare the shared package’s browser. Read-only readiness checks do not download it. The pinned runtime is Remotion 4.0.520, mediabunny 1.55.5 and React/React DOM 18.3.1; all consumers should resolve one copy of mediabunny. `getMediaFFmpegPath` from the same entry resolves FFmpeg from the selected dependency owner without preparing a browser. An existing runtime can be passed as `{runtime}`.

## Application interfaces (v1)

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

Run each complete example as its own `.mjs` file in a project with this package installed. The following extension snippets are adapter templates: the consuming host supplies their `host*`, workspace, execution and cancellation values. Every speech provider uses the same `voices()` and `synthesize(request)` contract:

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

`execution` is optional, ephemeral host context. Never serialize it or send it to the browser. Voice/provider errors remain errors: no automatic fallback to another voice, local engine or vendor. Returned duration is measured from WAV bytes, ignoring vendor duration estimates. This version requires WAV at the provider boundary; conversion from a vendor's native format belongs in that adapter. Word timing is not promised; current captions synchronize exact synthesized segments.

The same registry is available to DSH extensions as `ctx.artifactServices.registerSpeechProvider(provider)`. Both Studio and `speech_synthesize` use that registry. HTTP, credentials and any institution voice catalog belong to the provider adapter; `speech_synthesize` is the shared tool permission boundary. Applications calling a provider directly must preserve the host execution context and its permission policy.

Image generation uses the same separation:

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

Providers receive `prompt`, optional `size`/`fit`, the absolute `projectPath`, and ephemeral `execution`, `sessionId` and `signal`. They return an absolute `path` to a real workspace PNG/JPEG/WebP/GIF/AVIF, with optional `mime`, `size`, `requestedSize`, `generationSize`, `sourceRelativePath`, `sourceSize`, `resized` and `resizeWarning`. The service validates image signatures and workspace boundaries, normalizes the public result and strips other provider fields. Credentials stay inside the host adapter. Native size selection and resizing belong to the selected provider; the generic service does not impose a vendor's size list. Preserve the original image when resizing fails and report its actual size and warning.

`images.list()` returns `{id,title,local,available,capabilities}`. No available provider is an error; multiple available providers require an explicit choice. There is no automatic fallback. DSH extensions use `ctx.artifactServices.registerImageProvider(provider)`. Registration/unregistration emits `artifact-services/images-changed`; adapters call `ctx.artifactServices.refreshImageProviders()` after credential/configuration changes. This updates the bundled `artifact-images` skill availability. An assembly using `{skills:false}` owns that capability filtering itself.

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

Office preserves the previous document and spreadsheet edit actions, inspection/validation, presentation layouts, PDF create/merge/extract, and HTML previews. Presentation specs accept `speaker_notes`; spreadsheet create/edit/append support `{type:'text',value:'=literal'}` and `{type:'formula',value:'=SUM(A1:A2)'}`. Ordinary scalar strings retain legacy formula behavior. Formula validation does not calculate values. `renderOfficePreview()` is a bounded structural HTML preview, not a pixel-exact Office render.

Configure a Python interpreter containing `python/requirements.txt` through `DSH_OFFICE_PYTHON`. The legacy `CHATECNU_WORK_OFFICE_PYTHON` variable remains accepted. The isolated interpreter runs this package's bundled Python source, not separately maintained installed `ecnu_agent_*` scripts. Dependency provisioning is an explicit deployment step; no generation request installs software. Optional school assets are supplied with `DSH_OFFICE_BRAND_ASSETS`; none are bundled here.

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

Structured audio/video and editable Remotion projects use `lib/remotion.js`. The editable runner retains source editing, staging, integrity-bound voice jobs, full validation, covers and quality-review frames. `runVideoCommand(command, options, runtime)` is its callable API; `createMediaRuntime()` resolves the component's own dependencies. A deployment can instead inject its verified managed runtime. Old CLI environment checks remain for legacy launchers.

## DSH composition

Load `@eduwork/dsh-artifact-services/dsh` once. It provides `artifactServices`, six generic skills plus `artifact-images` when enabled and available, ten default tools and two opt-in image tools:

| Tools | Responsibilities |
| --- | --- |
| `office_document`, `office_spreadsheet`, `office_presentation`, `office_pdf` | Existing Office tool names and workspace-relative paths |
| `speech_voices`, `speech_synthesize` | Provider/voice/music discovery and speech generation |
| `image_providers`, `image_generate` | Opt-in image discovery/generation; omitted unless `images.enabled:true` |
| `speech_transcription_providers`, `speech_transcribe` | Audio-file transcription provider discovery and transcription |
| `media_render` | Structured audio/video generation |
| `video_project` | Editable project init/staging/voice jobs/validation/rendering |

Do not also register the legacy `tool-office` plugin. Keep permissions, credentials and publication in DSH. Tool adapters pass cancellation and original execution context to nested vendor tools. Config `{skills:false}` allows an assembly to manage generic skill registration itself. `{bgmRoot}` selects an alternative verified catalog; default is the included six-track library.

## Assets, builds and compatibility

- Six instrumental BGM cues include score JSON, deterministic synthesis code, 192 kbps MP3 files and hash/level/loop metadata. See [BGM usage and licensing](media/BGM-USAGE.md).
- `templates/structured` is the structured video source. `templates/editable` is the modifiable starter project. Different templates share the renderer; they are not separate render engines.
- No third-party audio samples or school logos are included. Remotion keeps its own license.
- Office operations remain limited to supported OOXML/PDF features; macros, tracked changes, animation editing and formula calculation are outside the supported feature set.
- Tests require a configured Python runtime. The parent repository runs Office editing/preview/validation, provider contracts, music integrity, original video-runner regressions and browser checks.

## Host image configuration

Image generation is disabled by default in the DSH service. Deployments that
provide image generation must explicitly set `images: { enabled: true }` in the
ArtifactServices plugin configuration. This startup option controls the image
tools, skill and provider invocation together. Local images used by Office and
video remain supported. Speech and video capabilities are independent of this
option.

## Platform support

The built-in system TTS adapter supports Windows. Other platforms require a registered speech provider and compatible native resources. See [platform requirements](docs/PLATFORMS.md).
