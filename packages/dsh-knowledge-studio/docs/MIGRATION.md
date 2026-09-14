# Migration and assembly

## Current compatibility boundary

The release pair is Studio `0.5.0` and Shared `0.2.0`, validated against official DSH `0.1.5-rc.1` / `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`. Do not infer support for other DSH versions from retained compatibility code. Historical Studio 0.4.0 / Shared 0.1.0 installation instructions targeted an older host and are not upgrade instructions for this pair.

Install both exact package versions into an isolated consumer first. Preserve the prior package archives and Profile configuration for rollback. Existing installations, sessions and output files are not migrated merely by passing source tests.

## One implementation per capability

Register `artifactServices` once. Loading the Studio bundle already installs the shared DSH service; do not independently activate it again. Both Studio and conversation tools use the same Office Python engine, speech registry, media renderer, timing utilities and actual-file preview. A host that manages skills centrally can use shared configuration `{skills:false}` and expose the same packaged skills.

After verifying existing workflows in the consuming host, retire duplicate Office/TTS/video executors. Provider extensions should retain credentials, governed network calls, capability registration and optional institutional assets. They should not copy Python engines, Remotion templates, timestamps or BGM files. Memory and institution login remain optional and independent.

Ordinary conversation results use the official `present` tool when available to declare verified final files. Do not create a second delivery event or automatically present intermediate revisions. Studio retains its own artifact settlement and download flow. Official document preview handles ordinary document types in the host; Office and media extensions reuse shared services. This plugin does not replace the host’s ordinary file browser.

## Native Sidebar

Studio opens from the official Sidebar Start page in its own tab. The host owns collapse, fullscreen, session tab restoration and global panel navigation. Studio does not read or write the old open preference on this baseline, add a blank-session replacement entry, or create a reading portal. Office and mindmaps use native fullscreen; the shared Office viewer still accepts an optional `onExpand` callback for other consumers.

Old hosts retain compatibility code, including persisted open preferences and reading-layer support. That retained code is not the current UI contract or a claim that old hosts have been requalified. Keep legacy preference files intact; they must not reopen Studio in a new session on the current host.

## Existing content and files

Wiki generation, its tools, RPC methods, settings and reader are excluded. Existing database tables, task records and saved files are retained without automatically resuming retired Wiki tasks. There is no supported flag that enables Wiki in this release. Old Wiki/search view selections return to Studio home.

Mindmaps retain their `nodes` / `parentId` format. Existing maps are not rewritten; PNG/SVG/Markdown export the full graph, including collapsed branches. Old heading/bullet slides and existing PPTX files remain readable. Reports, slides and tables preview saved DOCX/PPTX/XLSX files through Shared, including files with no sidecar. Preview never fabricates a replacement when a file is missing.

**Retry export** uses saved validated content without a model request, creates a new output directory and preserves prior remnants. **Regenerate** requests new model content. A failed draft does not become a completed Office file by downloading it. Model generation, file validation, preview fidelity and original-file freshness remain separate checks. See [output validation](STUDIO_VALIDATION.md).

The six shared BGM IDs now resolve to 192 kbps MP3. Consumers must read `catalog.json` rather than hardcode `.wav` names. Original scores, master hashes, license information and loop durations remain. Previously rendered user media is unchanged. Speech provider output is still WAV; BGM compression does not change that interface.

The media runtime is pinned to Remotion `4.0.520`, mediabunny `1.55.5` and React/React DOM `18.3.1`. A host that supplies a separate runtime must update its own locked projection; plugin tarballs do not carry `node_modules`. The provisionable environment template uses these same versions. Do not disable checks to accept a mixed runtime.

## Persisted identities

Package names are `@eduwork/dsh-knowledge-studio` and `@eduwork/dsh-artifact-services`. If upgrading an old unscoped install, update module references in dependencies, Profile bundles and Cordis module names together, but keep configuration and row IDs intact. Never enable old and new bundles simultaneously.

The `dsh-knowledge-studio` settings namespace, knowledge/artifact directories, `knowledgeStudio` / `artifactServices` service names and historical `.ecnu-agent/video-projects` references remain stable. Legacy Office environment variables and generator markers remain supported inputs. They are compatibility identifiers, not required institution integrations.

A consuming product must validate old sessions, saved artifacts, permissions, installation, upgrade and rollback with its actual package set. The source’s synthetic tests do not certify every user Profile or external model/provider.
