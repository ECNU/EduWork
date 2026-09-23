# EduWork official Electron desktop integration

[简体中文](README.md)

An assembly entry separate from `dsh-desktop/` (Go + Wails). Both hosts share the same EduWork product composition, plugins, skills and preview implementation.

The desktop baseline is DSH `0.1.5-rc.2` (`fb2c4b9e698e30edb738bca4cf0618587db7d203`). Electron's main process, window, `dsh-app://` handling and streaming Host transport are derived with reviewable patches from that commit, without modifying the shared upstream source cache. The reusable Host adapter lives in `../dsh-host/`.

Each distribution has its own application identity, browser cache, DSH data and credentials. Desktop builds use the locked npm plugin combination. Update sources come from distribution configuration; the public edition defaults to GitHub, and users can override the source or disable updates. Development checks use isolated data directories.

On macOS, the running Dock icon and the next startup window’s icon and progress bar follow the red/blue color scheme. The startup preference is cached in `visual-style.json` in the application user-data directory; the app bundle and signature stay unchanged. A native Dock tile plugin reads the same cache after the app exits, retaining the selected color. Finder and Launchpad retain the default brand icon; Stage Manager synchronization is not guaranteed. After first upgrading to a version with the Dock plugin, remove and re-add an existing pinned tile if it still reverts to the default color, so the Dock loads the plugin.

## Build

For a complete Windows test package, use the [build guide](../docs/BUILD.md#从-web-到桌面). It defines prerequisites, public and institutional commands, and output paths. From a clean EduWork checkout with Git, PowerShell 7, Node.js 24.18.0, Go 1.26.6 and Visual Studio 2022 C++ Build Tools:

```powershell
$Version = (Get-Content source-receipt.json -Raw | ConvertFrom-Json).version
./scripts/ci-eduwork-windows-release.ps1 -CoreRoot . -EditionRoot . `
  -DistributionConfig config/distributions/generic.json -Version $Version `
  -Development -Output ../eduwork-electron-test
```

Use a development-format version (`X.Y.Z-dev.YYYYMMDD.N`) and a new output directory. This invokes the same recipe as CI and produces a tested ZIP under `publish/`; it does not publish a Release. The recipe resolves pinned upstream source and prepares Host, native resources and Electron without requiring undefined local input variables. Actual login, media quality and upgrades need separate acceptance.

For Host or shell development, inspect [the shared recipe](../scripts/ci-eduwork-windows-release.ps1) for the prepared `host/`, `product/`, `inputs/`, `electron/` and `shell/` directories. [Native input preparation](../scripts/prepare-windows-release-inputs.ps1) records paths and resource hashes in `inputs/inputs.json`. `assemble-desktop-candidate.ps1` supports `electron`, `wails` and `both`; use both only when checking shell parity. The official Host has no npm package at the pinned baseline and is built from fixed upstream source. macOS requires separate adaptation and native acceptance.

## Local data and updates

Electron defaults to `<installation>/data/<distribution>-electron/{dsh,browser,logs}`, with system-encrypted credentials stored separately in the browser directory. Wails uses `<installation>/data/<distribution>-wails/dsh` and its own Windows Credential Manager namespace. Move the complete folder only after exit; registered external workspace paths must still resolve.

Ordinary startup does not scan other installations. A verified update handshake from the Go transition version imports its current data directory, without both shells writing to one session store.

The tray provides Open, New conversation, Check for updates, Settings and Exit. `config/eduwork.jsonc` selects the update source. The [portable update adapter](src/portable-updates.mjs) reuses the shared download/install controller for development/public-beta channels, progress and restart installation. A validated legacy handshake invokes `legacy-migration.mjs` to import either old `data/dsh` or transition-version data while retaining the originals. Settings also supports explicitly selecting an old client root to inspect and merge history. Validate migration against each actual release ZIP. Installers, signing and macOS require their own implementation and acceptance.

For Windows archives serving Go transition users, run `build-legacy-shortcuts.ps1 -Candidate <electron-candidate>`, then `pack-migration-release.ps1 -Candidate <electron-candidate> -Output <zip> -Migration wails-host-v1`. This creates a small launcher for old shortcuts, not a Go desktop shell.

## Verification
```powershell
node --test dsh-electron/tests/native-vault.test.mjs dsh-electron/tests/lifecycle.test.mjs dsh-electron/tests/media-transport.test.mjs dsh-host/test/product-profile.test.mjs
node dsh-electron/tests/desktop-smoke.mjs --shell electron --product $Product --cdp http://127.0.0.1:9333 --data-root $TestData --evidence $Evidence
node scripts/verify-desktop-parity.mjs --reference $DesktopProduct --electron $ElectronProduct --wails $WailsProduct --evidence $ParityResult
```

Window checks use explicitly enabled local debugging ports. Electron accepts `--remote-debugging-port=9333 --remote-debugging-address=127.0.0.1`; Wails uses `EDUWORK_DESKTOP_CDP_PORT=9334`. Both default to no debugging listener. Electron's `EDUWORK_DESKTOP_TEST_DATA_ROOT` and Wails's `--home` isolate synthetic test data.

`tests/desktop-preview-acceptance.mjs` checks real-file preview/upload. `tests/desktop-conversation-acceptance.mjs` sends two bounded synthetic requests only to an explicitly configured private test provider and removes temporary credentials on exit. Do not include test configuration in product archives. See [native vault and OIDC tests](tests/oidc-native-vault.md). Record the actual verified scope and limitations with release evidence; internal test logs and user data do not belong in source packages.

Ordinary web links open in the system browser while the application remains on the local workbench. `tests/external-navigation.electron.mjs` uses real hidden Electron pages to test same/new-window links, captures browser-launch calls without opening account pages, and requires no debugging port. Static navigation policies have separate unit tests.

For macOS color-scheme checks, run `dsh-electron/tests/dock-theme.electron.mjs` with Electron. It covers the isolated preload, red/blue switching, startup preference persistence and untrusted message rejection. Run `node --test dsh-electron/tests/dock-plugin.test.mjs` to build and verify the native Dock plugin for the stopped app; Xcode Command Line Tools are required.
