# Platform requirements

Artifact Services provides JavaScript APIs and Office/media helpers. Native runtimes are supplied by the host. The built-in `system` speech provider has Windows and macOS backends; other operating systems require a provider adapter.

## Office and media

Supply Python 3.12+ with the package's `python/requirements.txt`, and set `DSH_OFFICE_PYTHON` to its interpreter. Fonts and native wheels must match the target operating system and architecture. Office preview supports the documented structural features; native Office applications may render unsupported content differently.

Use the locked Remotion 4.0.520, mediabunny 1.55.5 and React/React DOM 18.3.1 runtime with matching Node, Chromium and FFmpeg. Offline hosts provide `DSH_MEDIA_NODE_ENV` and `DSH_MEDIA_BROWSER`. Capability discovery does not download components.

## Speech synthesis

`createSystemSpeechProvider()` keeps the same `system` id on both platforms, and `createMediaProviders()` registers it automatically. Windows uses System.Speech through PowerShell; macOS uses `/usr/bin/say`. Both are text-to-speech (TTS) for narration, separate from audio transcription (ASR). No extra EduWork configuration, API key, model, browser or FFmpeg installation is required for this system TTS adapter.

On Mac, voice discovery reads the system catalog and preserves the exact names, including spaces and localized names. Select one of these names rather than copying a Windows voice id. The default Chinese-text selection uses an installed Chinese voice. If none is installed, synthesis fails with an installation prompt. Install voices through macOS System Settings → Accessibility → Read & Speak (Spoken Content on earlier systems); see [Apple's voice settings guide](https://support.apple.com/guide/mac-help/mchlp2290/mac). The adapter does not initiate voice downloads. Voice inventory and quality vary with the operating system and installed voices.

Mac synthesis uses a UTF-8 input file and writes PCM16 WAV through `say`, without invoking a shell or playing through speakers. Speed uses the shared 0.25–4 multiplier with a 175 words/minute baseline; timings are measured from the resulting WAV, not assumed to equal Windows voice timings. The caller supplies an absolute authorized output directory and an alphanumeric, hyphen or underscore job name. Existing WAV files are not overwritten. Temporary input text is removed after the job; process receipts and diagnostics remain under a `speech-*` job subdirectory. Cancellation waits for process exit, escalates termination if needed, and removes partial output.

Other systems register a provider with `voices()` and `synthesize(request)`. Voice discovery may accept an optional `{signal}` during synthesis. Implementations should enumerate installed voices, honor text, voice, speed and cancellation, and return an actual WAV in the authorized output directory. Existing no-argument `voices()` implementations remain compatible.

Unavailable providers or voices are reported to the caller. They do not trigger a silent substitution. Video can explicitly omit narration when no voice is available.

For a provisioned Windows or Mac host, run the focused native check from the Studio package directory (the output's parent must exist and the output directory itself must not):

```sh
node scripts/system-speech-smoke.mjs --output /absolute/path/to/new-speech-check
```

This uses synthetic text and installed voices, measures actual WAV output and speed, tests invalid voice refusal, and tests live process cancellation/output preservation on Mac. Missing Chinese voices are recorded separately from a successful Chinese synthesis. The scoped macOS CI runs this check when the system speech implementation changes; it does not test Studio UI, playback quality or the packaged desktop application. Validate those on the target Mac before release. Source changes require publishing the shared package and updating the product's pinned component before reaching desktop builds.

## Transcription

The local adapter accepts an executable and model through `transcription.local`. The downloadable binary inventory currently covers Windows x64 only; macOS hosts must supply a compatible executable. Model acquisition, hashes and license notices belong to the host's component manager.

Validate CLI arguments, JSON output, Unicode/spaced paths, cancellation and permissions for each build. A missing local engine does not automatically upload audio to a remote provider. See [transcription configuration](TRANSCRIPTION.md).

## Desktop integration

Validate native components separately on each supported architecture. Do not copy Windows runtime directories to macOS. Packaged applications must preserve subprocess cancellation, workspace authorization and file permissions; macOS signing and notarization belong to the consuming desktop application.

This package transcribes audio files; it does not capture microphones or stream live audio. Platform support requires tests from the packaged application, including Office output, WAV/MP4 playback, captions, preview and download.
