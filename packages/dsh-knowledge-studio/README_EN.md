# DSH Knowledge Studio

Versions: Studio `0.6.0` / Artifact Services `0.3.0`. Requires Node.js 24.18+ and DSH 0.2.1-rc.2. No EduWork desktop bridge or institution account is required.

[简体中文](README.md)

A workspace-native knowledge and creation studio for DeepSeek Harness, with source-grounded documents, learning tools, audio, and video.

Studio reads existing workspace files and uses the host's conversations and configured model. Reports, slides, tables, mind maps, quizzes, flashcards, audio overviews and video overviews work directly from source files, using an existing local index when available. Native Sidebar fullscreen preserves the original conversation and draft; quizzes and flashcards keep progress.

Open Studio from the official Sidebar Start page. The host manages tabs, collapse and fullscreen. Interactive controls inherit blue/red and light/dark themes; exported files retain their authored colors.

On DSH 0.2 desktop builds, saved Word documents, spreadsheets and presentations open in the official file viewer through **Open file preview**, using the same entry as conversation files. Studio retains generation, downloads, speaker notes, citations and artifact management; quizzes, flashcards, mind maps and media remain interactive. Older hosts retain the previous Office preview adapter. The official spreadsheet view primarily displays cell content; use Office or WPS for complex layout and embedded objects.

Office skills reuse the host's official processing workflows. Studio reports, tables and slides share official validation and conversion with conversations; PDF exports convert the actual saved Office files. See [Office workflows](packages/artifact-services/docs/OFFICE_PROCESSING_EN.md) for host dependencies and legacy-format support.

## Packages

- **`@eduwork/dsh-knowledge-studio@0.6.0`**: workspace sources, Studio UI, saved artifacts and learning progress.
- **`@eduwork/dsh-artifact-services@0.3.0`**: shared Office/preview, TTS/ASR and media services, conversation tools and generic skills. No Studio or institution dependency.

Studio installs its matching shared-services package automatically. The plugin uses the Host’s existing model configuration; Office, speech and media operations additionally require the runtimes described below.

Install the exact versions in an existing Profile project:

```sh
dsh plugin --profile web add @eduwork/dsh-knowledge-studio@0.6.0
```

To build from source, run in `EduWork/packages/dsh-knowledge-studio`:

```sh
npm ci
npm run build
npm run pack:release
```

Copy both archives from `dist/packages/` to the target Profile project, then install them together from that project:

```sh
npm install ./eduwork-dsh-artifact-services-0.3.0.tgz ./eduwork-dsh-knowledge-studio-0.6.0.tgz
```

See [usage and Profile activation](docs/USAGE.md). Loading the Studio bundle registers shared services once. Do not also activate a duplicate shared service or legacy Office plugin.

Completion and failure can use the host's [plugin notification protocol](https://github.com/ECNU/EduWork/blob/main/docs/PLUGIN_NOTIFICATIONS.md). This service is optional: Studio continues to work without it and owns its artifact status and navigation.

## Capabilities and runtime

Conversation tools and Studio use the same generation and actual-file preview services, with Studio adding source citations and learning interactions. Editable React video projects are a conversation tool capability, not a separate Studio editor. Editable DOCX/PPTX/XLSX use the shared Python engine; PDF, CSV, HTML and Markdown are additional export formats. Audio/video output includes WAV/MP4, optional narration, captions, BGM and video previews. Speech providers share one application interface; Windows System.Speech and macOS system say provide offline narration with installed voices. Other platforms need an extension provider.

Provision Python 3.12+ with `packages/artifact-services/python/requirements.txt` and set `DSH_OFFICE_PYTHON` to its absolute interpreter path. Chromium may be prepared on first independent rendering or explicitly supplied by the deployment. Studio capability discovery never downloads it. Managed media uses Remotion `4.0.520`, mediabunny `1.55.5` and React/React DOM `18.3.1`. Local ASR requires a separately provisioned whisper.cpp executable and model; neither is bundled. No generation request installs Python dependencies.

Local search does not need embeddings or reranking services. Generation sends relevant material to the user's model and may incur model charges. Opening Studio does not prepare an index. Office support is structural, not a full Office replacement; it does not add macros, tracked changes or animation editing; formula recalculation uses the official LibreOffice Kit. Captions use measured speech segments, not word-level alignment. Render only trusted editable React projects.

[Architecture and extension APIs](docs/ARCHITECTURE.md) · [Development](docs/DEVELOPMENT.md) · [Migration](docs/MIGRATION.md) · [Changelog](CHANGELOG.md) · [Releasing](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/docs/RELEASING.md)

Our code uses [MIT](LICENSE). Remotion, Chromium, PDF.js and other dependencies retain their own terms. See [third-party notices](THIRD_PARTY_NOTICES.md) and [BGM provenance](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/packages/artifact-services/media/BGM-USAGE.md).

Platform support depends on provisioned speech, Office and media runtimes. See [platform requirements](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/packages/artifact-services/docs/PLATFORMS.md) for speech and native media dependencies.

Source, issues and PRs are maintained in [EduWork](https://github.com/ecnu/EduWork/tree/main/packages/dsh-knowledge-studio). Run development commands from `EduWork/packages/dsh-knowledge-studio`. npm installation remains independent. See [package publication](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md).
