# Temporary side chat (experimental)

[简体中文](README.md) | **English**

Status: an isolated experiment exists; unpublished and excluded from default product assembly. The pinned DSH `0.2.1-rc.2` supports branching and embedded chat, but does not alone provide the required temporary lifecycle. Local experiments require an explicitly built Runtime extension.

The experiment uses the historical `candidate-v0.2.1-rc.2` baseline. Mainline default products have moved to `0.2.1-rc.3` and are unaffected. Do not mix experimental artifacts into current default products or treat rc.2 acceptance as rc.3 certification.

Open a temporary side chat from a user message or completed assistant answer using the shared conversation components in the native right sidebar. Its transcript starts empty at event sequence 0. Source history through that point remains separate in memory and accompanies model requests as reference context; it never becomes side-chat transcript records or an active inherited task. Later source messages do not enter that snapshot. Model settings come from the selected historical prefix.

Side chats stay outside ordinary lists, history search and automatic memory indexing. Closing stops the session and discards messages and drafts. Switching conversations or previews, collapsing the panel and hiding the window do not discard it. A lease reclaims memory sessions left by abnormal disconnection; restart cannot restore them. Explicitly requested work-file changes and external actions are not undone on close.

The initial version allows one side chat per window, with no promotion, nested branching, subagents, scheduled tasks or long-lived background work. Tools follow the new session’s permissions.

## Local development

An empty chat centers “Side chats are temporary and disappear when closed.” The hint disappears after sending, while the composer stays at the bottom. Close with the native sidebar tab's ×. Selecting a completed response offers “Ask in side chat” in the annotation toolbar, adding an editable unsent annotation to the side composer. Further selections from the same source reuse the existing chat, cutoff and draft; the source draft stays unchanged. This action also requires the local annotation extension.

```sh
npm ci
npm run build
npm test
```

Run these commands in this package. Without `EDUWORK_SIDE_CHAT_RUNTIME`, `npm test` runs state/policy checks and explicitly skips real-Runtime integration tests. Set it to the experimental Runtime root containing `package.json` and `node_modules` to run those tests. Integration tests load the working-tree service with dependencies resolved from that Runtime, rather than a side-chat package installed there. Skipped checks are not passing evidence.

From the EduWork root, use `scripts/probe-side-chat-runtime.mjs` to inspect actual Runtime lifecycle behavior, and `scripts/build-side-chat-experiment.mjs` to produce an independent experimental Runtime. The builder requires a verified npm Runtime, the prepared pinned compiler and a new output directory. It preserves the original dependency cache.

The complete experiment from the repository root uses separate local directories:

```sh
node scripts/probe-side-chat-runtime.mjs --runtime <approved-runtime> --output <new-baseline-evidence>
node scripts/build-side-chat-experiment.mjs --runtime <approved-runtime> --compiler <prepared-compiler> --output <new-experiment>
npm pack ./packages/dsh-side-chat --pack-destination <local-tarballs>
npm pack ./packages/dsh-annotation --pack-destination <local-tarballs>
node scripts/assemble-side-chat-experiment.mjs --base-product <normal-product> --experiment <experiment> --compiler <prepared-compiler> --tarball <local-tarball> --annotation-tarball <local-annotation-tarball> --output <new-product>
node packages/dsh-side-chat/scripts/browser-test.mjs --product <experimental-product> --output <new-web-evidence>
node packages/dsh-side-chat/scripts/browser-test.mjs --product <candidate>/resources/product --desktop <candidate>/EduWork-Electron.exe --output <new-desktop-evidence>
```

Prepare the compiler using the [build guide](../../docs/BUILD.md). It must match the pinned DSH source and carry `.eduwork-build-tools.json`. On Windows, official source-archive symlinks may require Developer Mode or an externally prepared extractable compiler archive; never silently use an unprepared workspace. Normal product, shell and Windows-candidate assembly use their corresponding build scripts. Experimental outputs remain separate and disable automatic updates.

Browser/desktop acceptance runs the real Host/AgentLoop with a deterministic model adapter and synthetic conversations, without external model requests. Test data, startup credentials, screenshots and receipts belong only in the specified evidence directory outside the repository. Desktop mode runs the actual candidate executable and automatically confirms quit prompts for that isolated test instance.

See the [side chat proposal](../../docs/proposals/side-chat/README_EN.md) for product behavior. npm publication, default component-lock updates and desktop publication are separate actions.
