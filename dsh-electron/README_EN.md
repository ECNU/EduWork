# EduWork official Electron desktop integration

[简体中文](README.md)

An assembly entry separate from `dsh-desktop/` (Go + Wails). Both hosts share the same EduWork product composition, plugins, skills and preview implementation.

The desktop baseline is DSH `0.1.5-rc.2` (`fb2c4b9e698e30edb738bca4cf0618587db7d203`). Electron's main process, window, `dsh-app://` handling and streaming Host transport are derived with reviewable patches from that commit, without modifying the shared upstream source cache. The reusable Host adapter lives in `../dsh-host/`.

Each distribution has its own application identity, browser cache, DSH data and credentials. Desktop builds use the locked npm plugin combination. Update sources come from distribution configuration; no configured source means no automatic download. Development checks use isolated data directories.

## Build

Prepare the matching Web product first. `$WebProduct` selects public or institutional composition without copying business code into the shell. Variables below identify explicitly selected, verified local inputs. `$Node` points to `node.exe` from an official extracted Node distribution, with its adjacent `LICENSE` retained.
```powershell
node dsh-host/prepare.mjs --upstream $Upstream --output $HostAdapter
./scripts/prepare-desktop-product.ps1 -WebAssembly $WebProduct -HostAdapter $HostAdapter -Output $DesktopProduct

# Native resource inputs contain local resource paths, not account information.
./scripts/prepare-desktop-resources.ps1 -OutputRoot $DesktopProduct @NativeResourceInputs

./dsh-electron/scripts/prepare-electron.ps1 -Upstream $Upstream -Output $ElectronCache
node dsh-electron/scripts/build-shell.mjs --upstream $Upstream --host $HostAdapter --output $ElectronShellBuild
./scripts/assemble-desktop-candidate.ps1 -Shell electron -Product $DesktopProduct -HostAdapter $HostAdapter `
  -ElectronShellBuild $ElectronShellBuild -ElectronRuntime "$ElectronCache/runtime" `
  -Node $Node -OutputRoot $CandidateRoot -Version '0.3.5-dev.20260912.3'
```

`-Shell electron`, `wails` or `both` selects the output: `electron-candidate/` and/or `wails-candidate/`. Existing destinations are rejected. Electron requires installed build dependencies for the pinned upstream source; Wails requires Go, Windows build tools and WebView2.

Routine testing assembles Electron with public and ECNU profiles; use `both` for parity checks when changing Host or shell adapters. This DSH desktop Host baseline is built from fixed official source because it has no npm package. macOS still requires platform adaptation and native acceptance; Windows scripts do not produce a usable Mac release.

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
