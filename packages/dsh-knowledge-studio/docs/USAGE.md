# Usage

## Runtime requirements

Studio 0.5.0 / Shared 0.2.0 require Node 22.19+ or 24 and official DSH 0.1.5-rc.1. Install the matching exact npm versions after publication, or both reviewed local archives. Verify registry availability rather than inferring it from this document. Enable optional npm dependencies so LadybugDB can select its native platform package. Windows x64 and Linux x64 are CI targets; other listed native platforms are not yet covered by this project's CI.

The two package versions are coupled: Studio `0.5.0` requires Artifact Services `0.2.0` in this release. When installing from locally built archives, supply both tarballs in the same npm install. Do not use `--force` or `--legacy-peer-deps` to resolve a mismatched DSH host.

After installing into a Profile project, add `@eduwork/dsh-knowledge-studio` to its existing `dsh.profile.bundles` list without replacing other entries. The bundle patch registers `@eduwork/dsh-artifact-services/dsh` and Studio. Restart the host. A custom assembly that registers these services itself must not also activate a second Studio bundle.

For an existing Web Profile using the standard base and web bundles, the relevant `package.json` fragment is:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@eduwork/dsh-knowledge-studio"
      ]
    }
  }
}
```

Merge only the Studio entry into the actual Profile; preserve its dependencies, existing bundles and other configuration. This fragment is not a replacement manifest or a desktop installation command. For a disposable development Web host, use `npm run dev:web` in the source checkout after preparing its dependencies.

## Office

Provision Python and the shared package's requirements explicitly:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r packages/artifact-services/python/requirements.txt
export DSH_OFFICE_PYTHON="$PWD/.venv/bin/python"
```

On PowerShell:

```powershell
python -m venv .venv
& .venv/Scripts/python.exe -m pip install -r packages/artifact-services/python/requirements.txt
$env:DSH_OFFICE_PYTHON = (Resolve-Path .venv/Scripts/python.exe).Path
```

For an npm installation, the requirements file is under `node_modules/@eduwork/dsh-artifact-services/python/requirements.txt`. Production generation uses this package's bundled Python source. Optional presentation branding is supplied via `DSH_OFFICE_BRAND_ASSETS`; no school assets are required.

## Browser, speech and BGM

Independent PDF/video rendering prepares Remotion's Chromium if needed. Studio capability discovery is read-only; provision the media environment before expecting its media actions to become available. For a pre-provisioned or offline deployment, set **both** `DSH_MEDIA_NODE_ENV` (absolute directory containing package.json and node_modules) and `DSH_MEDIA_BROWSER` (absolute Chromium executable path). The environment must contain the pinned Remotion 4.0.520 modules, mediabunny 1.55.5 and React/React DOM 18.3.1. With explicit configuration the service never falls back to downloading a browser. Video posters use FFmpeg from the selected media dependency owner without preparing a browser.

Windows System.Speech supplies the included local adapter. Voices depend on installed OS voices; other platforms require an extension provider for narrated media. Unavailable providers remain unavailable instead of silently changing the requested voice. Videos can omit narration and BGM. Six 192 kbps MP3 loops are included, with scores, master hashes and individual license metadata; dialogue and Studio read the same catalog. They may be extended through the shared registry. This is a licensed project asset library, not a claim that AI-generated music has no copyright.

## Workspace flow

Enter an existing workspace conversation in DSH, expand the official right sidebar, and select **Studio** on its **Start** page. If another file tab is active, use **New tab** to return to Start. Use the host’s **Fullscreen / Exit fullscreen** controls for reading. Studio has no separate expand-reading button or portal. Blank conversations and global panels follow the official host’s navigation; a missing blank-session entry is not an installation error. Choose a source scope, output type and parameters. Reports, slides and tables produce editable files; sources and scripts are secondary, collapsible details. Quizzes and flashcards save interaction state.

An artifact's collapsed revision history identifies saved versions and distinguishes successful intermediate versions from failed, cancelled or interrupted attempts. When the latest revision fails and the task keeps an earlier usable result, a visible notice identifies the displayed version. The current result remains previewable and downloadable; earlier revision files and records are retained.

The artifact toolbar provides a **下载…** (Download) menu with names describing the contents, rather than treating every download as another format of the same result:

| Result | Downloads |
| --- | --- |
| Audio | WAV audio, Markdown transcript, and SRT/WebVTT subtitles when generated |
| Video | MP4 video, Markdown scenes and narration, and SRT/WebVTT subtitles when generated |
| Report | DOCX, PDF, and Markdown report text |
| Slides | PPTX, PDF, HTML preview, and Markdown outline and speaker notes |
| Table | XLSX and CSV |
| Mindmap | PNG/SVG diagram and Markdown outline |
| Quiz / flashcards | Markdown and printable PDF, including answers / both card sides |

Audio/video Markdown contains editable text, not playable media. Subtitle downloads contain narration text with segment timings; they do not contain sound or video. Generic audio/video PDFs and JSON artifact metadata are omitted from the ordinary download menu. Existing export APIs and previously saved files remain available for integrations.

Studio creates artifacts directly from workspace files. Existing local indexes remain usable for source retrieval; opening Studio does not build an index or start a model task. This build does not include Wiki generation or reading. Previously saved workspace data is retained for future migration decisions.

Opening an artifact citation renders its saved source excerpt as Markdown, including headings, lists, tables and code. The source path, location and original-file action remain available, and changed or unavailable files are identified as saved snapshots. Raw HTML is skipped, unsafe links are filtered, and source images are shown as text placeholders without automatically requesting external images.

Local search stays on the machine; model-written artifacts send necessary material to the configured model. Host permissions and configured provider policies still apply.

## Configuration ownership

Studio uses the host’s model configuration; the public plugin needs no institution login or private endpoint. Its `indexedRetrievalTools` option defaults to false and only exposes optional existing-index tools when true; it does not enable Wiki. Keep persisted namespaces and paths unchanged during upgrades.

Shared configuration supports `skills:false` when the host manages the same packaged skills, `bgmRoot` for an integrity-checked catalog, `transcription.local` for host-provisioned whisper.cpp, and `images.enabled:true` for explicitly enabled image-provider tools. Image tools are not an infographic Studio. Load `@eduwork/dsh-artifact-services/dsh` only once; the Studio bundle already includes it. Credentials and provider URLs belong in host configuration or a thin extension, never in the public package or browser payload.

For local ASR configuration and provider registration, see the [shared transcription guide](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/packages/artifact-services/docs/TRANSCRIPTION.md). TTS consumes text and emits WAV; ASR consumes an audio file and emits text. Microphone capture and realtime transcription are outside this release.
