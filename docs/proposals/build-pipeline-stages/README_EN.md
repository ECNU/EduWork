# Cross-platform desktop build pipeline proposal

[简体中文](README.md) | **English**

Status: this PR implements the Node.js build scripts, Windows/macOS stage catalogs, local entry point, caches, and preflight. Main changes automatically build and retain both development apps. The manual candidate workflow can build and publish dual-platform candidates through the Node pipeline.

## Goal and scope

The same Node.js tools organize Web assembly, the Host, native inputs, Electron packaging, and acceptance on both platforms. `scripts/local-desktop-pipeline.mjs` is the local entry point; `ci-eduwork-windows-release.mjs` and `ci-eduwork-macos-release.mjs` use platform-specific stage catalogs. System tools, native resources, and final packages remain platform-specific.

This proposal covers desktop builds, acceptance, and GitHub Release artifact delivery. npm publication, institution deployment, and macOS Developer ID signing and notarization retain their separate approval and acceptance processes.

![Windows and macOS desktop build stages](../../assets/build-pipeline.svg)

The diagram summarizes the shared product, Host, and native-input preparation through Electron packaging, launch acceptance, and delivery files. The actual build uses the pinned source recipe for product preparation, and macOS adds a Sparkle update stage. Editable sources are `docs/assets/build-pipeline.drawio` and `build-pipeline.mmd`.

## Implemented design

- `pinned-source-stages.mjs` declares the source recipe shared by development builds and candidates; `windows-stages.mjs` and `macos-stages.mjs` add platform packaging stages. Each stage declares `requires`, `dependsOn`, `outputs`, and `mutableOutputs`.
- The runner derives order and concurrency from dependencies. Checkpoints record parameters, inputs, and artifact digests. Reusing a workspace rejects changed catalogs and missing or modified outputs.
- An exclusive workspace lock prevents concurrent writes. Large artifacts can use size-based verification, and the actual verification strength remains visible.
- Native downloads are cached by pinned hash. Compile results are keyed by source, patches, target, and tool versions; restored entries are verified again. Caches live outside the source tree.
- Preflight checks tools, directories, upstream caches, and pinned resource URLs before downloads and compilation.

## Current integration

| Scenario | Entry point | Status |
| --- | --- | --- |
| Local Windows x64 / macOS arm64 development build | `node scripts/local-desktop-pipeline.mjs` | Uses the staged pipeline |
| Dual-platform development workflow | `development-desktop.yml` → both Node stage entries | Automatically builds and retains accepted artifacts after main changes |
| Manual dual-platform candidate and publication | `desktop-candidates.yml` → `node` | Node stages and the pinned DSH `0.2.0-rc.2` candidate recipe; supports alpha/beta/rc/dev/stable |
| Legacy source candidate | `desktop-candidates.yml` → `ps1` | Retained for comparison with the pinned source recipe |

Development builds and both `node` and `ps1` candidates use `config/desktop-build.json` to select the `0.2.0-rc.2` combination: the pinned npm Runtime, upstream-source Host, and rebuilt product plugin clients. The Node path invokes no PowerShell scripts. After archive and packaged-app launch checks on both platforms, publication verifies ZIPs, the DMG, hashes, receipts, the Windows installer, and approved notes before uploading a GitHub Release. The macOS DMG contains the app accepted from the ZIP and is checked as a read-only image; stable builds require Sparkle configuration. Development builds retain artifacts only; manual candidates can be published after authorization.

## Follow-up

Acceptance still to complete:

| Area | Work required |
| --- | --- |
| Institution acceptance | Public candidates skip institution-only checks. Institution candidates verify descriptors and signed first launch. The private `validationScript` runs only in the PowerShell candidate; any additional checks it performs need comparison and migration in the institution repository before they can be claimed for Node. |
| Package acceptance | Build and launch the new Node candidate on Windows x64 and macOS arm64, then check its artifacts and receipts. |
