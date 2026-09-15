# DSH Knowledge Studio

Versions: Studio `0.5.0` / Artifact Services `0.2.0`, pinned to official DSH `0.1.5-rc.1` (`183f08e9c6dde7e36cd2318eaee70b0da08fb35e`). The plugins use stable SemVer; their host baseline remains a release candidate. Other DSH versions are not covered by this compatibility statement.

[简体中文](README.md)

A workspace-native knowledge and creation studio for DeepSeek Harness, with source-grounded documents, learning tools, audio, and video.

Studio reads existing workspace files and uses the host's conversations and configured model. Reports, slides, tables, mind maps, quizzes, flashcards, audio overviews and video overviews work directly from source files, using an existing local index when available. Native Sidebar fullscreen preserves the original conversation and draft; quizzes and flashcards keep progress.

Open Studio from the official Sidebar Start page. The host manages tabs, collapse and fullscreen. Interactive controls inherit blue/red and light/dark themes; exported files retain their authored colors.

## Packages

- **`@eduwork/dsh-knowledge-studio@0.5.0`**: workspace sources, Studio UI, saved artifacts and learning progress.
- **`@eduwork/dsh-artifact-services@0.2.0`**: shared Office/preview, TTS/ASR and media services, conversation tools and generic skills. No Studio or institution dependency.

Studio requires the exact shared version. Official DSH **0.1.5-rc.1** and Node **22.19+ or 24** are the current baseline; do not use the old DSH 0.1.2 installation instructions for this version. The two packages retain independent SemVer versioning; their versions do not track the consuming product.

The rc.1 baseline here applies to independent npm installations. EduWork desktop uses a locked rc.2 Runtime and projects plugin payloads from pinned npm packages without resolving peer dependencies again in the runtime directory. This is a separately validated product combination. Follow the [product build guide](https://github.com/ecnu/EduWork/blob/main/docs/BUILD.md) for desktop builds; do not apply the independent rc.1 overrides to the product Runtime.

Before running the command, the host must pin all direct and transitive `@deepseek-ai/dsh*` dependencies to `0.1.5-rc.1` using complete root-level npm `overrides` and a verified lockfile. Pinning only the top-level package can resolve rc.2 through upstream caret peer ranges and cause `ERESOLVE`. Use `npm ci` for an existing locked assembly; do not bypass conflicts with `--force` or `--legacy-peer-deps`.

Install the exact versions in an existing Profile project:

```sh
npm install @eduwork/dsh-artifact-services@0.2.0 @eduwork/dsh-knowledge-studio@0.5.0
```

To build from source, run in `EduWork/packages/dsh-knowledge-studio`:

```sh
npm ci
npm run build
npm run pack:release
```

Copy both archives from `dist/packages/` to the target Profile project, then install them together from that project:

```sh
npm install ./eduwork-dsh-artifact-services-0.2.0.tgz ./eduwork-dsh-knowledge-studio-0.5.0.tgz
```

See [usage and Profile activation](docs/USAGE.md). Loading the Studio bundle registers shared services once. Do not also activate a duplicate shared service or legacy Office plugin.

## Capabilities and runtime

Conversation tools and Studio use the same generation and actual-file preview services, with Studio adding source citations and learning interactions. Editable React video projects are a conversation tool capability, not a separate Studio editor. Editable DOCX/PPTX/XLSX use the shared Python engine; PDF, CSV, HTML and Markdown are additional export formats. Audio/video output includes WAV/MP4, optional narration, captions, BGM and video previews. Speech providers share one application interface; Windows system speech is the included offline adapter, with locally installed voices. Other platforms need an extension provider for narration.

Provision Python 3.12+ with `packages/artifact-services/python/requirements.txt` and set `DSH_OFFICE_PYTHON` to its absolute interpreter path. Chromium may be prepared on first independent rendering or explicitly supplied by the deployment. Studio capability discovery never downloads it. Managed media uses Remotion `4.0.520`, mediabunny `1.55.5` and React/React DOM `18.3.1`. Local ASR requires a separately provisioned whisper.cpp executable and model; neither is bundled. No generation request installs Python dependencies.

Local search does not need embeddings or reranking services. Generation sends relevant material to the user's model and may incur model charges. Opening Studio does not prepare an index. Office support is structural, not a full Office replacement; it does not add macros, tracked changes, formula calculation or animation editing. Captions use measured speech segments, not word-level alignment. Render only trusted editable React projects.

[Architecture and extension APIs](docs/ARCHITECTURE.md) · [Development](docs/DEVELOPMENT.md) · [Migration](docs/MIGRATION.md) · [Changelog](CHANGELOG.md) · [Releasing](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/docs/RELEASING.md)

Our code uses [MIT](LICENSE). Remotion, Chromium, PDF.js and other dependencies retain their own terms. See [third-party notices](THIRD_PARTY_NOTICES.md) and [BGM provenance](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/packages/artifact-services/media/BGM-USAGE.md).

macOS is not fully supported. See [platform requirements](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/packages/artifact-services/docs/PLATFORMS.md) for speech and native media dependencies.

Source, issues and PRs are maintained in [EduWork](https://github.com/ecnu/EduWork/tree/main/packages/dsh-knowledge-studio). Run development commands from `EduWork/packages/dsh-knowledge-studio`. npm installation remains independent. See [package publication](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md).
