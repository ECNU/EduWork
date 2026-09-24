# DSH 0.1.7-rc.1 migration candidate

[简体中文](README.md)

This directory pins upstream source and npm Runtime inputs for migration checks. **It is not a qualified desktop baseline.** Default builds still use `release-v0.1.5-rc.2`. Do not replace an installed EduWork Runtime or an existing user's data with this candidate.

- Upstream commit: `46a7f68b0922371ce7144b668b90e377d8e799f4`, tagged `dsh-v0.1.7-rc.1`.
- `LOCK.json` records the Git source commit and tree, pnpm lock, npm install lock and package integrity. Runtime packages come from the official npm registry, with one pinned DSH family version.
- Only the published npm Runtime is enabled. Source packing remains disabled; existing product plugin npm locks are unchanged.
- Separate official Web Host adapters, native settings migration and source-plugin qualification are available. The default release assembly remains unchanged; these checks alone do not qualify the complete desktop product.
- rc.1 checks DSH peer dependencies at startup. The candidate build assigns exact rc.1 peers only to rebuilt product-owned plugins and marks those artifacts private. It does not modify third-party packages, add compatibility exemptions, or change existing npm release declarations. The assembled startup probe rejects combinations that silently disable incompatible plugins.

Prepare a separate Runtime from the repository root. The output directory must not exist:

```powershell
node dsh-desktop/scripts/prepare-dsh-runtime.mjs --source npm --lock third_party/dsh/candidate-v0.1.7-rc.1/LOCK.json --output C:/EduworkTest/runtime-017
```

Run the real upstream service and synthetic migration probe (Windows, macOS and Linux; adjust paths for your platform):

```powershell
node scripts/probe-dsh-017.mjs --runtime C:/EduworkTest/runtime-017 --output C:/EduworkTest/probe-017
```

The probe verifies the installation receipt and creates a new DSH home. It checks local Web authentication, services including settings and presets, read-only V3 migration, V4 successor publication, extension preservation, and refusal of corrupt logs. The output's `report.json` contains the results. Keep the directory for inspection and use a new directory for another run. Upstream startup logs can contain a local authentication URL; do not post raw logs to public issues.

Run the separate file-transcription adapter probe without downloading speech models:

```powershell
node scripts/probe-dsh-017-speech.mjs --runtime C:/EduworkTest/runtime-017 --output C:/EduworkTest/speech-probe-017
```

This uses the real DSH `speechToText` registry, WAV validator and the Runtime's FFmpeg, with a synthetic recognizer. It checks Unicode paths, resampling, chunks beyond the upstream single-request size limit, duration limits, no cloud fallback, provider replacement and cancellation. An optional `--ffmpeg` selects an absolute path to a provisioned FFmpeg. The output directory must not exist; results are written to `report.json`. This does not test SenseVoice inference or recognition accuracy.

Qualify Host authentication, update admission and streaming (`--upstream` must contain the pinned source commit):

```powershell
node dsh-host/prepare-native.mjs --upstream C:/EduworkTest/source-017 --output C:/EduworkTest/host-017
node scripts/probe-eduwork-017-host.mjs --runtime C:/EduworkTest/runtime-017 --host C:/EduworkTest/host-017 --output C:/EduworkTest/host-evidence
```

For source plugins, copy `source-probe/package.json` and `package-lock.json` into a separate `C:/EduworkTest/source-deps` directory and run `npm ci --legacy-peer-deps --ignore-scripts` there, then:

```powershell
node scripts/build-017-plugin-clients.mjs --runtime C:/EduworkTest/runtime-017 --dependencies C:/EduworkTest/source-deps --output C:/EduworkTest/source-stage --report C:/EduworkTest/client-build.json
node scripts/probe-eduwork-017-settings.mjs --runtime C:/EduworkTest/runtime-017 --dependencies C:/EduworkTest/source-deps --source C:/EduworkTest/source-stage --full-product --output C:/EduworkTest/settings-evidence
```

This mode builds into an isolated directory without changing published packages or checked-in generated files. It checks legacy preferences, native validation, live editing, restart persistence, optional presets and authenticated RPC for organizations, Studio, memory, components and skills. Use `--serve` to keep the synthetic workspace available for UI testing. Its `launch.json` contains a temporary authentication token; do not publish it. This source probe excludes literature, while the assembled product below retains the published family. `--legacy-peer-deps` applies only to the isolated supplemental dependencies; the frozen candidate Runtime supplies all DSH peers.

Original settings are retained as a migration backup, with new preferences in a separate native `desktop-017` Profile. The user-facing product configuration remains `eduwork.jsonc`. Legacy custom presets keep their source directories and IDs, while the official registry manages converted definitions. Plugins used by third-party presets still need individual compatibility checks.

Qualify product outputs in native deliverables, then verify plugin resolution and restart in an assembled directory:

```powershell
node scripts/probe-017-deliverables.mjs --runtime C:/EduworkTest/runtime-017 --output C:/EduworkTest/deliverables-evidence
node scripts/assemble-017-source-product.mjs --runtime C:/EduworkTest/runtime-017 --source C:/EduworkTest/source-stage --dependencies C:/EduworkTest/source-deps --host C:/EduworkTest/host-017 --output C:/EduworkTest/source-product
node scripts/probe-017-source-product.mjs --product C:/EduworkTest/source-product --host C:/EduworkTest/host-017 --output C:/EduworkTest/assembled-evidence
node scripts/probe-017-literature.mjs --product C:/EduworkTest/source-product --output C:/EduworkTest/literature-evidence
```

The source product combines the locked npm Runtime with separately built product plugins. It is marked `source-qualification` and excluded from releases. The assembled probe launches real child processes without source import redirection, with synthetic in-memory credential storage. The deliverables probe uses real tools, filesystem and sessions with a synthetic generator; failure, cancellation, escaping paths and failed nested transports must not publish files. The candidate uses upstream file intake and deliverable cards while retaining extended previews shared with Studio. The literature family remains at published version `0.1.2`, with version and bundle integrity checks. Its probe uses synthetic retrieval to test real tool execution, output validation and full-text file writing, not external search sites. The source product does not include the complete local media resources.

These checks do not cover live model requests, organization sign-in, Studio generation, native windows, Office/media rendering or application updates, and do not establish compatibility with every historical session. Complete those checks before promoting the desktop release baseline. Candidate CI uploads reports, not raw startup logs containing authentication URLs.
