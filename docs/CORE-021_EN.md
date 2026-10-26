# DSH 0.2.1 integration

[中文](CORE-021.md)

The current build recipe selects DSH `0.2.1-rc.3`, upstream commit `1f81c047fc48fa190a683e469daa699857e9afe8`. `config/desktop-build.json` points to the [candidate lock](../third_party/dsh/candidate-v0.2.1-rc.3/LOCK.json); npm Runtime, Host and Electron sources are verified separately. Product and core versions are independent. Selecting this recipe does not publish installers or change update feeds.

## Capabilities and migration

- rc.3 adds More menus to the left sidebar, conversation views and right sidebar, using the official plugin discovery entry. Creation keeps the native Creator session and append-draft policy without sending a message. When Show coding view or Creator is disabled, the item points to the relevant setting without enabling it automatically.
- Use the upstream unsent-draft recovery fix while retaining drafts, attachments and annotation references. DeepSeek API-key mode uses the official dynamic model catalog; custom endpoints and catalogs keep their own configuration.
- Reuse the official plugin manager, browser and Office capabilities. [Selection quotes and notes](../packages/dsh-annotation/README_EN.md) ship as an independent npm package, also installable from the Plugins page in other compatible clients. The new DeepSeek Search / Fetch API providers use native settings; existing EduWork search defaults, user choices and browser fallback remain available.
- Schedule is now part of the upstream base composition. Upgrades remove dependency and activation references to the retired experimental Schedule bundle while preserving task storage, settings and other plugins. The obsolete bundle is no longer installed.
- Official developer tools are available as an optional bundle. Request capture is not enabled by default. Enable diagnostics through the official plugin mechanism when needed and inspect exported data.
- Literature and desktop pets continue to use published npm versions selected by their component locks. A core upgrade alone does not require republishing plugins to change version declarations.
- Existing distribution policy still governs official analytics, session uploads and feedback controls. User configuration and sessions are preserved. Historical session migration must not overwrite original files or silently accept corrupt logs.

## Adaptation boundaries

Remove the loopback-address/ephemeral-port patch and the file-reference rescan undo-history patch, both now implemented upstream. EduWork retains file-card presentation, desktop integration and product plugins.

Active-session persistence can still disrupt searches: the relevant implementation in the locked npm package is byte-identical to the previous version. Keep the [search consistency backport](SESSION-SEARCH-BACKPORT.md), its complete file-hash check, and the upstream-failure/regression tests. Remove it when upstream provides an equivalent fix.

Keep the settings navigation icons, user-message annotation decoration seat and client-module metadata guard. rc.3 still treats the ctime change from unlinking a differential-update backup as a code rebuild; the guard skips a reload only when both mtime and code bytes are unchanged. The new menu gate respects edition preferences; upstream still owns preset registration, workspace selection and drafts.

Ordinary startup follows DSH presentation: load the static page in a hidden main window, show it once the Host is ready, then let BootPage finish loading client plugins and enter the workspace. Initial configuration downloads and legacy migration show that same main window's BootPage earlier, display preparation status, and continue into the workspace when ready. Preparation follows the system appearance until upstream loads the theme settings. Branding remains, and failures use a dedicated recovery window. Dock activation, tray actions and repeated launches can restore the current preparation or recovery window; completing preparation does not force a window the user has hidden back into view.

## Building and verification

See the [build guide](BUILD.md) for entry points. Assembly stages read the version and commit from one recipe, while individual source hashes and npm integrity checks remain mandatory. `validate-pinned-dsh-source.yml` exercises the actual Host, Electron bridges, assembled product, settings and plugins on Windows/macOS.

Historical-session and speech adapter probes also use the current recipe and new synthetic data directories:

```sh
node scripts/probe-dsh-017.mjs --runtime <prepared-runtime> --output <new-evidence-directory>
node scripts/probe-dsh-017-speech.mjs --runtime <prepared-runtime> --output <another-new-directory>
```

These probes use no real accounts or model inference and do not replace native desktop or release-upgrade acceptance. The previous combination remains documented in [DSH 0.2.0 integration](CORE-020_EN.md) and its original locks.
