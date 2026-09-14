# Platform requirements

Artifact Services provides JavaScript APIs and Office/media helpers. Native runtimes are supplied by the host. The built-in system speech provider supports Windows; macOS requires additional platform integration.

## Office and media

Supply Python 3.12+ with the package's `python/requirements.txt`, and set `DSH_OFFICE_PYTHON` to its interpreter. Fonts and native wheels must match the target operating system and architecture. Office preview supports the documented structural features; native Office applications may render unsupported content differently.

Use the locked Remotion 4.0.520, mediabunny 1.55.5 and React/React DOM 18.3.1 runtime with matching Node, Chromium and FFmpeg. Offline hosts provide `DSH_MEDIA_NODE_ENV` and `DSH_MEDIA_BROWSER`. Capability discovery does not download components.

## Speech synthesis

The Windows adapter uses System.Speech through PowerShell. Other systems register a provider with `voices()` and `synthesize(request)`. Enumerate installed voices, honor the requested text, voice, speed and cancellation, and return an actual WAV file in the authorized output directory.

Unavailable providers or voices are reported to the caller. They do not trigger a silent substitution. Video can explicitly omit narration when no voice is available.

## Transcription

The local adapter accepts an executable and model through `transcription.local`. The downloadable binary inventory currently covers Windows x64 only; macOS hosts must supply a compatible executable. Model acquisition, hashes and license notices belong to the host's component manager.

Validate CLI arguments, JSON output, Unicode/spaced paths, cancellation and permissions for each build. A missing local engine does not automatically upload audio to a remote provider. See [transcription configuration](TRANSCRIPTION.md).

## Desktop integration

Validate native components separately on each supported architecture. Do not copy Windows runtime directories to macOS. Packaged applications must preserve subprocess cancellation, workspace authorization and file permissions; macOS signing and notarization belong to the consuming desktop application.

This package transcribes audio files; it does not capture microphones or stream live audio. Platform support requires tests from the packaged application, including Office output, WAV/MP4 playback, captions, preview and download.
