# ChatECNU Work artifact presentation

[简体中文](README.md)

DSH 0.2 desktop builds use `src/client/native.js`. Official components own attachment intake, deliverable cards and general file preview; this entry adds audio/video playback and preview layout stabilization. The legacy card and attachment adapters below remain for older hosts.

This replaceable DSH client plugin is a narrow compatibility derivative of
`@deepseek-ai/dsh-client-ui-deliverables@0.1.2-rc.1`. It replaces that one
plugin without changing DSH Core, the rest of the Web UI, or the Agent loop:

- retains upstream DSH's canonical produced-file derivation from successful
  mutation events (never from model prose);
- renders an expandable, path-disambiguated produced-file summary and resolves inline file mentions;
- adds pointer and keyboard feedback plus Open, Reveal in Folder and Copy Path actions;
- opens supported files in DSH's resizable session-scoped details column, with tabs, PDF, sandboxed HTML, DOCX/XLSX/PPTX and rendered/source Markdown modes;
- keeps tool-specific image, audio and office artifact cards.

It occupies the product Conversation derivative's narrow
`conversation.input.add` child seat, replacing two adjacent controls with one
add menu. Selecting, pasting or dropping a non-image file copies it into the
current workspace and inserts a DSH structured file-reference occurrence. The
composer shows the short file name and native file glyph while submission and
clipboard persistence retain the canonical `@file` mention.
In the desktop build this follows Codex's native-file boundary. The final DSH
loopback page does not depend on Wails' bootstrap-only `window.runtime`; it uses
WebView2 `postMessageWithAdditionalObjects` directly. The Wails shell resolves
and copies regular files into an application-private one-time grant, then returns
only the grant receipt through a shell callback. The DSH host redeems that grant
into the workspace. File bytes never travel through Client/Remote JSON. The browser
fallback remains available for small development-only files up to 4 MiB.
Supported raster images are handed directly to Conversation's official
`intakeImages` callback and durable image pipeline; the native command menu
remains available from the same add menu. No new session message block type is
introduced.

The media extension only reads or reveals regular files within the owning
session workspace. Official document previews use the official file service's
read permissions. Unsupported formats fall back to the DSH host opener.
First-party `write`, `edit` and mutating `str_replace_editor` calls keep the
official DSH argument-based derivation. Product tools may additionally publish
successful output paths through DSH `presentCall` locations; merely mentioning
a path in model prose does not register a file. This keeps click, context-menu
and preview behavior grounded in tool/runtime facts.

The precise upstream commit, approved difference surface and retirement
condition are declared in `package.json` and `UPSTREAM.md`.

DSH 0.2 uses the official document viewer: Word and PowerPoint are converted to
PDF, spreadsheets use the official sheet view, and PDF, images, HTML, Markdown
and text remain official. Studio opens saved Office artifacts in the same file
tabs; generation, downloads and interactive artifacts remain in Studio. Older
hosts retain Artifact Services' Office preview adapter. PDF/HTML exports are
unchanged.

Official preview scrollports reserve space for classic scrollbars to prevent
repeated auto-fit rendering at boundary window sizes. Fit-width and manual zoom
remain available.

`build-client.ps1` accepts `-DshLockPath`, `-ArtifactServices` and `-Output`.
Source assembly profiles build into their own derived package directory.
An older pinned Shared package without that export retains the committed client
bundle. A selected package with the export is rebuilt against that profile's
DSH baseline. No LibreOffice runtime is included.
