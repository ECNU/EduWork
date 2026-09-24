# Audio-file transcription

The application contract is `TranscriptionService.transcribe({provider,inputPath,language?,directory?,signal?,execution?,sessionId?})`. It returns `{text,provider,model?,language?,duration?,segments?:[{start,end,text}]}`. Times are seconds; segments are optional and are not promised to be word-aligned. Empty text is a valid silence result. `inputPath` is an absolute existing audio file. The service accepts WAV, MP3/MPGA/MPEG, M4A/MP4, OGG, FLAC and WebM up to 100 MiB; a provider may impose a smaller limit.

`new TranscriptionService()` has no provider and performs no download. Register a provider with `register({id,title,local,timestamps,model,available?,transcribe})`; the disposer removes that exact registration. Discovery returns only public metadata/readiness. Provider config, credentials and `execution` are not exposed to the browser. Unknown, unavailable, failed or cancelled providers never fall back to another engine or a cloud service.

## Local CPU adapter

```js
import {TranscriptionService, createWhisperCppTranscriptionProvider} from '@eduwork/dsh-artifact-services'
const transcription = new TranscriptionService()
transcription.register(createWhisperCppTranscriptionProvider({
  executablePath: hostRuntime.whisperCLI,
  modelPath: hostRuntime.whisperModel,
  model: 'whisper-tiny-q5_1',
  threads: 4,
}))
const result = await transcription.transcribe({
  provider: 'whisper-cpp', inputPath: authorizedAudioPath,
  directory: applicationOwnedJobDirectory, language: 'zh', signal,
})
```

The adapter uses the shared FFmpeg resolver, converts to 16 kHz mono PCM, then runs `whisper-cli` with CPU inference and JSON output. It never prepares a browser. An optional host `ffmpegPath` can select a provisioned FFmpeg executable directly. Jobs retain conversion/inference logs and process receipts. Local input duration defaults to 3,600 seconds; hosts may configure `maxDurationSeconds` from 1 to 14,400. Oversized duration fails instead of returning a silently truncated transcript.

The Windows CLI is invoked with relative ASCII job filenames so Chinese workspace/audio paths work. Node always stages a private `model.bin` copy in the Windows job, then removes it after completion, failure or cancellation; the configured model is never overwritten or hard-linked. This also avoids the CLI's legacy path limit when it combines a deep working directory with an otherwise ASCII model path. Allow temporary space equal to the selected model (approximately 30.7 MiB for tiny-q5_1). The native executable still requires its job's own audio/output paths to fit Windows path limits. Before creating the job or invoking a native process, the adapter checks the planned job path including its suffix and output filename; paths reaching 260 characters receive an actionable error asking for a shorter workspace/task directory.

## Optional DSH 0.1.7 local adapter

`createDshTranscriptionProvider` connects a host's existing `speechToText` service to the same file-transcription API. It is opt-in: the published desktop composition still registers Whisper, and this adapter does not mount official speech bundles, download models, prepare a recognizer or change the microphone's selected provider.

```js
import {createDshTranscriptionProvider} from '@eduwork/dsh-artifact-services/transcription-dsh'

// In a DSH 0.1.7 host that has explicitly enabled the official speech bundle:
ctx.inject(['artifactServices', 'speechToText'], ctx => {
  ctx.effect(() => ctx.artifactServices.registerTranscriptionProvider(
    createDshTranscriptionProvider({speechToText: ctx.speechToText}),
  ))
})
```

| Option | Default | Meaning |
| --- | --- | --- |
| `speechToText` | Required | The host-owned official service, shared with voice input. |
| `id` | `dsh-sensevoice` | Provider id exposed by the file-transcription API. |
| `title` | `Local SenseVoice (DSH)` | Display name. |
| `providerId` | `sensevoice-local` | Exact upstream provider to use; it must report `host-local`. Cloud providers are rejected. |
| `ffmpegPath` | Shared media runtime | Optional absolute path to a provisioned FFmpeg executable; no browser or engine download. |
| `maxDurationSeconds` | `3600` | Whole-file duration ceiling, integer 1–14,400. Oversized audio fails before inference. |
| `chunkSeconds` | `60` | Integer 1–120. Sequential canonical 16 kHz mono PCM16 WAV requests; 120 seconds remains below upstream's default 4 MiB limit. If the host lowers that limit, lower this option accordingly. |

Prepare the official model explicitly in the host before using this provider. Discovery is read-only; ready, standby and waking resources can accept work. A selected provider is pinned before conversion and remains pinned for every chunk. Removal/replacement, failed inference and cancellation fail the whole request; no partial transcript or automatic cloud fallback is returned. Regional language hints such as `zh-CN` can map to an advertised base language such as `zh`; unsupported languages fail explicitly.

FFmpeg converts the authorized input to a canonical WAV in a caller-owned job directory and keeps process logs/receipts there. Inference reads bounded chunks instead of retaining the whole decoded file in memory. The result's duration comes from the complete decoded audio. Automatic language selection is not reported as a detected language. The upstream transcript API has no segment timestamps, so discovery advertises `timestamps:false` and results omit `segments`. Chunk boundaries are not forced-alignment timestamps. Fixed chunk boundaries can affect recognition at a cut; validate long recordings and supported languages before replacing an existing provider. Keep Whisper available for timestamp-dependent or otherwise unqualified workloads.

The candidate probe in `scripts/probe-dsh-017-speech.mjs` uses the real official registry and FFmpeg with a synthetic recognizer; it does **not** verify SenseVoice accuracy, microphone permissions or native desktop behavior. TTS is a separate service: the target upstream speech subsystem does not implement speech synthesis, and this adapter leaves local/remote TTS unchanged.

## Host-owned optional components

`getTranscriptionComponents()` returns a versioned recommendation containing HTTPS source URLs, platform, file size, license and SHA256. It does not fetch or install anything. The host should show size/license, obtain the installation decision, download to staging, verify the pinned checksum, extract safely, and inject absolute paths. Keep engine libraries and license files together. Other platforms can provide an equivalent built CLI through the same adapter.

The pinned Windows CPU runtime is whisper.cpp v1.8.3 (`whisper-bin-x64.zip`, 3,968,674 bytes). The multilingual tiny-q5_1 model is 32,152,673 bytes, SHA256 `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7`. Model weights and native runtimes are not included in the npm package. Source: [official whisper.cpp release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.3), [pinned model repository](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1).

| Option | Footprint and scope | CPU/quality considerations |
| --- | --- | --- |
| Whisper tiny | Official unquantized table: 75 MiB disk, approximately 273 MB memory; multilingual | General-purpose file transcription. Quantization reduces disk size; do not assume memory falls in the same proportion. |
| Whisper tiny-q5_1 | Approximately 30.7 MiB model, plus native runtime; implemented adapter | No Python/CUDA. Chinese transcription can have substantial homophone errors; review generated text. |
| sherpa-onnx Chinese Zipformer 14M | Official rounded int8 sizes: encoder 21 MiB, decoder 1.8 MiB, joiner 1.7 MiB; tokens and runtime extra | Chinese only. The documented int8 command actually uses the 7.2 MiB fp32 decoder, approximately 29.9 MiB combined. A future provider can use the same application API. |

Sources: [Whisper runtime and memory table](https://github.com/ggml-org/whisper.cpp#memory-usage), [official sherpa 14M model sizes and decoding examples](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html#csukuangfj-sherpa-onnx-streaming-zipformer-zh-14m-2023-02-23-chinese). These figures are not directly comparable memory benchmarks. Actual latency depends on processor, threads, audio and model. On one Windows AMD Ryzen AI 9 H 465 test with 4 threads, synthetic English 6.88 s / Chinese 9.25 s audio completed in approximately 1.27 s / 1.22 s including conversion. This demonstrates execution only: the Chinese result had visible errors, and sherpa was not benchmarked on that machine.

## Configurable remote adapter

```js
import {createOpenAICompatibleTranscriptionProvider} from '@eduwork/dsh-artifact-services'
const dispose = ctx.artifactServices.registerTranscriptionProvider(
  createOpenAICompatibleTranscriptionProvider({
    id: 'host-asr', title: 'Organization transcription',
    baseURL: hostConfig.audioBaseURL, // API prefix, normally ending in /v1
    model: hostConfig.audioModel,
    getHeaders: request => hostCredentials.headersFor(request.execution),
  }),
)
ctx.effect(() => dispose, 'organization: transcription provider')
```

The adapter sends one multipart POST to `audio/transcriptions` under that baseURL, including `file`, `model`, `response_format=json` and optional `language`. It does not require segment timestamps. Set `responseFormat:'verbose_json'` only when the configured model supports it; discovery then advertises timestamps. Some models support JSON text only. Remote uploads default to 25 MiB; configure `maxBytes` if the provider requires a smaller limit. The generic service ceiling remains 100 MiB. Redirects and automatic retries are disabled. Vendor error bodies and credentials are never echoed. [OpenAI transcription contract](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

The DSH adapter exposes `speech_transcription_providers` and `speech_transcribe({input_path,provider,language?})`. It resolves audio through the host filesystem and rejects paths/junctions outside the current Agent workspace before creating output jobs. The DSH tool boundary performs the single permission check; application callers must authorize their own path and provider selection. Selecting a remote provider uploads the file and may consume its quota. The shared service itself does not show another permission or billing dialog. Microphone capture and realtime streaming are outside this version's contract.
