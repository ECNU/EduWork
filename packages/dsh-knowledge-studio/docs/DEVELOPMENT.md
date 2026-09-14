# Development and verification

Use a fresh checkout with its own dependencies. Do not run npm installation through a junction into a shared assembly runtime. On Windows, use `.venv/Scripts/python.exe` and set `DSH_OFFICE_PYTHON` with `Resolve-Path`; see [usage](USAGE.md). Managed media requires Remotion 4.0.520, mediabunny 1.55.5 and React/React DOM 18.3.1. Configured CI targets are not evidence that the latest commit has passed both platforms.

For documentation-only review, keep the runtime freeze unchanged: run the public/document audit, validate edited runnable examples, pack into a separate review directory and compare every non-document entry against the frozen archives. Do not rebuild or overwrite the frozen tarballs merely to change prose.

Media-specific probes are `media-capacity-smoke.mjs` (six MP3 probes, one mediabunny resolution, conversation BGM staging and a 61-second loop/ducking render), `local-media-smoke.mjs` (Windows system narration, mixed audio and MP4), and `media-playback-smoke.mjs <local-media result.json>` (actual browser playback). Use fresh `STUDIO_CAPACITY_OUTPUT` and `STUDIO_ADAPTIVE_OUTPUT` directories to preserve earlier results; Office creation deliberately refuses overwrites. Local media speech tests require an installed Chinese system voice. `STUDIO_MEDIA_OUTPUT` and `STUDIO_PLAYBACK_OUTPUT` select their evidence directories. Technical playback checks do not establish listening quality.

This repository is an npm workspace. `lib/` contains maintained Host JavaScript alongside generated `client.js`, `pdf-runtime.js`, `pdfjs.js` and the shared video template. Do not clear `lib` during builds.

The current candidate locks official DSH 0.1.5-rc.1, commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`. Final assembly tests must use the same verified runtime for both the host launcher and every plugin DSH import. Setting only `STUDIO_TEST_DSH_RUNTIME` does not change Node resolution from a symlinked plugin checkout. `scripts/verify-dsh-runtime.mjs` checks both package importers against an assembly runtime receipt; use an isolated dependency layout and never modify a shared runtime. `scripts/session-v3-smoke.mjs` exercises actual V3 sessions, production artifact settlement, and persistence-handle round trips without a model service.

```sh
npm ci
python -m venv .venv
.venv/bin/python -m pip install -r packages/artifact-services/python/requirements.txt
export DSH_OFFICE_PYTHON="$PWD/.venv/bin/python"
npx playwright install chromium
node scripts/prepare-test-runtime.mjs
npm run check
npm run test:ui
npm run test:host
npm run test:host:ui
npm run test:host:mindmap
npm run test:host:office
npm run test:exports
```

Linux CI installs Chromium system dependencies with `npx playwright install --with-deps chromium`. `prepare-test-runtime` writes runtime paths to ignored `.dev-local/test-runtime.json` and, on GitHub Actions, exports them using `GITHUB_ENV`. Locally set the three variables in that JSON in the current shell before the browser checks; no private desktop runtime is assumed.

`check` covers types, builds, Node regression tests, LadybugDB P0, public-source auditing and both release tarballs. The documentation audit checks JSON examples, neutral business examples, and local Markdown links in both the source tree and each actual package archive. Cross-package or repository-only pages use full public GitHub links. UI suites exercise slow/failed media loading, stale responses, collapsible controls, reading mode and preserved draft state. `test:host` starts a real public DSH composition in a new temporary home, checks authenticated HTTP and Studio RPC, then stops its own process. It does not use an existing user's home or configured models.

`test:exports` creates actual report/slides PDFs, checks pages and text using pypdf, and extracts a JPEG poster with real FFmpeg. The same probe accepts `STUDIO_PACKAGE_ROOT` to verify an installed package. Isolated-dependency Node tests separately verify that Studio cannot resolve Remotion directly and that managed PDF/poster paths avoid browser preparation.

`npm run dev:web` starts a fresh isolated DSH home on an available loopback port and writes its authenticated URL to that home. Configure a model in that host when manually exercising generation. Stop it with Ctrl+C; existing homes and desktop installations are not touched. For long local checks, use a background runner that records PID, start time, stdout/stderr and a result file under ignored `dist/`.

The optional legacy `test:host:preferences` starts a real host, checks first-use closed state, saves
an explicit open preference, restarts on a new port with new authentication,
then repeats with an explicit closed preference. `STUDIO_PREFERENCE_OUTPUT`
selects its evidence folder. `test/artifact-lifecycle.test.mjs` drives complete
validated generators through failures, repairs and turn events; tools receive
attempt results while the public artifact projection remains in progress until
turn end. Component tests additionally verify automatic opening never writes
the explicit preference. This retained API is not the current native Sidebar opening behavior. `test/presentation-pagination.test.mjs` verifies atomic
metric/bullet blocks, balanced continuation pages and lossless oversized blocks.
`office-adaptive-smoke.mjs` generates actual PPTX and checks fields, notes, fonts,
page mappings and browser rendering. Independent native Office review remains
separate from structural and browser checks.

Tests use synthetic materials. Raw local host logs may contain access URLs and must remain in the temporary home. Publish only reviewed, credential-free result summaries. CI uploads synthetic outputs under `dist/ui`, `dist/host`, `dist/exports` and `dist/packages`.

Cross-platform CI does not establish desktop installation, upgrade or rollback behavior. Real model quality, vendor TTS and user-data upgrades require deployment-specific acceptance.

## Integration checks

`test:ui` runs four synthetic component suites. Some fixtures retain old-host top-right toggles and expanded readers for compatibility. The current UI contract is checked by `test:host:ui`: the official Sidebar Start entry and host fullscreen, without a Studio reading portal. These are separate scopes, not alternative current installation instructions.

`test/studio-release-boundary.test.mjs` verifies the retired Wiki entry points are absent, old task/consent records remain untouched and saved legacy table content survives normal index access. Artifact generation and source retrieval use synthetic fixtures without external model calls.

`test:host:mindmap` seeds synthetic old-schema artifacts before a real Host boots, checks actual SVG nodes/edges, navigation and view persistence, then downloads full MD/SVG/PNG while branches are collapsed. An independent XML parser and Pillow verify hierarchy, image content and bounds. `test:host:office` seeds a real eight-layout PPTX, checks all eight shared-viewer pages against actual converted slide markup and source hash, verifies page/zoom persistence when reading expands, parses UI-downloaded PPTX/PDF, and verifies a full failed-draft download. These probes never submit model prompts or touch an existing user's home.

Run both probes on each exact supported DSH baseline using `STUDIO_TEST_DSH_RUNTIME`. Set `STUDIO_MINDMAP_UI_OUTPUT` / `STUDIO_OFFICE_UI_OUTPUT` for separate evidence directories. Helper entry points are `startIsolatedHost({syntheticMindmap:true})` and `startIsolatedHost({syntheticOffice:true})`; the latter also includes a failed draft. Stable browser markers are `data-mindmap-canvas`, `data-mindmap-node`, `data-mindmap-edge`, `data-office-file-preview` and `data-studio-draft`. The SVG/PNG and PPTX exports must also be visually reviewed; structural success alone does not establish presentation quality.

`test:exports` includes `office-preview-scaling-smoke.mjs`: a synthetic actual PPTX is opened through the shared viewer at wide/narrow widths, its inner geometry and wrapping stay identical while the frame scales, and its converted HTML is printed to PDF with Chinese text and page dimensions checked. `office-preview-client-smoke.mjs` checks independent bundles sharing reading state, refresh/reopen, new-file invalidation, 4:3 pages, explicit page limits and resource isolation; `STUDIO_OFFICE_CLIENT_OUTPUT` selects its evidence directory. `office-preview-service.test.mjs` checks content identity, font invalidation and immutable snapshot cleanup. These use configured runtimes, make no model calls, and keep evidence in ignored `dist/`. A consuming host must additionally verify real model generation and native Office rendering before deployment.

`test/evidence-labels.test.mjs` covers eight-schema short-label restoration, strict rejection of mutated labels/hash IDs, source-bundle boundaries, concurrent request isolation, canonical persistence/exports, raw failed drafts and a real six-layout PPTX export after model-response simulation. Recent-artifact buttons can be targeted by `data-studio-artifact-id` for same-title retries.

`test:exports` also includes `office-metrics-layout-smoke.mjs`, covering four neutral themes with percentage/arrow comparisons, eight-digit values, long Chinese labels and full detail text. It inspects actual PPTX and shared HTML for intact values, a single value line and text-box bounds. Use `STUDIO_METRICS_OUTPUT` to keep evidence for each baseline separate. LibreOffice is an optional development-machine visual verification tool, never a bundled runtime dependency or preview fallback.

`office-export-recovery.test.mjs` covers the shared field contract, same-ID PPTX recovery with unchanged content/citations/model metadata, cancellation, concurrent clicks, invalid source/checkpoint rejection, readability failures and actual DOCX/XLSX recovery. `test:host:office` also clicks **重试导出** on a seeded legacy Office failure, checks the completed persisted payload and downloads the recovered PPTX with spaced comparisons. Unvalidated drafts have no recovery action. Metric smoke includes both original values and spaced decimal/percentage comparisons on two real slides per theme, with a 12 pt minimum font assertion. No test submits an external model request.

Set `STUDIO_TEST_DSH_RUNTIME` to an independently prepared DSH runtime root to run `test:host` or `dev:web` against that exact baseline. These scripts read its `node_modules` and create an isolated home; they do not install into or modify that runtime. Omit the variable for the repository's locked development dependency.

`npm run test:host:ui` opens Chromium against that real isolated host. Before boot, `startIsolatedHost({syntheticSession:true})` calls `scripts/host-session-fixture.mjs` to create a filled conversation through the selected baseline's public Jsonl persistence API. It uses turn/start, user/message, turn/end and session/title events, the host's default compression and a newly created session store. Existing session stores are refused. The browser registers the synthetic workspace, hydrates the filled session with native `session/rename` and uses its accepted (possibly truncated) title, then creates a blank session through native RPC. No model prompt is submitted.

The current host check selects the official Sidebar probe: independent Studio/file tabs, native close, host fullscreen without a Studio portal, drafts, automatic fullscreen below 768 px, widening, global main-panel navigation and legacy preference isolation. Blank sessions follow official controls without a replacement entry. `STUDIO_HOST_UI_OUTPUT` selects an evidence directory. Point `STUDIO_TEST_DSH_RUNTIME` at the separately prepared exact rc runtime; leave it unset only when the checkout already has matching dependencies. Runs use disposable homes and skip API-key onboarding. Runtime provisioning belongs to the deployment; this plugin does not patch host persistence or disable locking.

`node --test test/transcription.test.mjs` checks provider registration, secret-free discovery, multipart JSON/optional timestamps, redirects, upload limits, cancellation and workspace/junction boundaries using a loopback HTTP fixture. `npm run test:asr` additionally requires explicit `STUDIO_ASR_CLI` and `STUDIO_ASR_MODEL` paths; it synthesizes English and Chinese test speech with installed Windows voices and runs actual CPU inference. Provisioning is a separate host action; this check never downloads components. Its result under `dist/asr` records model hash, CPU, threads, text and timings. This synthetic smoke is not an accuracy benchmark.
