# Windows setup package

[中文](PORTABLE-EXTRACTOR.md)

This optional first-download asset is a ZIP containing `EduWork-Setup.exe` or `EduWork-ECNU-Setup.exe`. The EXE embeds the original Windows desktop release ZIP unchanged. The setup UI uses the product name, icon, and actual version from that release, with destination selection, progress, cancellation, and a launch button after installation. GitHub Release assets display their full filename, `EduWork-<version>-windows-x64-setup.zip` or `EduWork-ECNU-<version>-windows-x64-setup.zip`, without a display label replacing it. The setup UI does not add a separate “portable edition” label.

The setup program offers one-click and custom installation, with optional desktop shortcut creation. It does not change PATH or startup entries. The application's existing behavior determines where configuration and data are stored. Recognized installations of the same edition can be replaced after confirmation. Application updates continue to use the existing updater.

## Build

Use Windows, PowerShell 7, and the Go toolchain pinned by `dsh-desktop/go.mod`:

```powershell
./scripts/pack-portable-extractor.ps1 `
  -Archive '<verified Windows release ZIP>' `
  -ExpectedSHA256 '<release ZIP SHA-256>' `
  -OutputDirectory '<new output directory>'
```

The input must contain the Electron product identity, brand icon, and `RELEASE-MANIFEST.json`. Outputs include `*-windows-x64-setup.zip`, its SHA-256 sidecar, and a receipt recording the extractor source commit, dirty state, Go version, and payload and asset hashes. Public assets should use committed, clean source.

The builder does not reassemble the application or change the original release ZIP, application version, or update source. Keep the canonical `*-windows-x64-electron.zip` asset for existing updaters. Add the extraction package and verification files as separate assets on the same Release. Release notes remain subject to maintainer approval.

## CI and release pipelines

Windows candidate, development, and release recipes invoke `prepare-windows-portable-extractor.ps1` by default. It builds the extraction ZIP, reads and verifies its sole EXE, and uses that executable to extract the original release. Existing manifest, native runtime, and desktop launch checks then run against that output. A failed step prevents a successful receipt.

The `publish` directory contains both ZIPs, their SHA-256 sidecars, and receipts. The release publisher requires eight verified files and binds the extractor to the original ZIP, version, distribution, and clean core source commit before upload. Update manifests still reference only the original ZIP. Source Alpha workflows retain build artifacts only; public publication and release notes require maintainer approval.

Public and institution editions share this recipe. Institution repositories adopt it through `core.lock.json`, without copying the implementation. macOS builds do not produce the Windows extractor. Dedicated PR CI builds and extracts synthetic stable and development packages for both brands and checks that missing or modified publication files are rejected before upload.

## Validation and limits

- Verify the embedded ZIP SHA-256 and manifest identity, file count, paths, and sizes before extraction.
- Extract through Go file APIs with support for complete paths beyond the traditional 260-character limit. Check each file's CRC, size, and SHA-256.
- Extract into a private sibling staging directory, then rename it after verification. Clean only that staging directory on failure or cancellation; report its location if cleanup fails.
- Probe directory creation, rename, and removal before extraction. Retry temporary sharing or access-denied errors during the final rename for at most five seconds, allowing cancellation. Report source, destination, and the system error on failure, and never replace a destination created during the wait.
- Installation and updates grant Windows restricted application packages read/execute access to explicitly listed Electron runtime files and language packs, preventing sandbox startup failures caused by inherited directory ACLs. Directory grants do not inherit into configuration, credentials, or conversations; no write access is granted. A failed repair rolls back its permission changes.
- Normal startup relies on actual Electron sandbox execution and does not modify installation ACLs, so an inability to change permissions is not mistaken for an inability to run. Installers and updaters still grant the runtime access described above. If a directly extracted ZIP cannot start, keep the startup log and reinstall with the latest setup package. Do not automatically request elevation or disable the Electron sandbox.
- Accept a new local destination or a confirmed existing Electron installation of the same edition; check disk space and write access. The launch EXE's complete path must be shorter than 260 UTF-16 units. Internal files may exceed that length, but this does not guarantee arbitrary long-path support in every bundled third-party tool.
- Verify the new release before replacing manifest-owned program files. Preserve `config/`, `data/`, environment files, and extra files. Restore old files on failure or cancellation; retain and report the backup if restoration fails. After explicit consent, close processes running from that installation directory; unsaved work may be lost.
- Overwrite installation and automatic updates share an installation lease, held before closing clients through replacement, rollback, and cleanup. An applying update, a running update helper, or an update backup requiring recovery blocks overwrite with instructions to wait or recover; the helper is never terminated. Ordinary clients receive a normal close request first; only remaining processes are terminated after a timeout and explicit consent.
- No forced elevation. Embed `asInvoker` and `longPathAware` without modifying Windows registry settings.
- The outer ZIP simplifies delivery and avoids Explorer expanding deep application directories. It does not guarantee antivirus acceptance. The build script does not perform Authenticode signing.

Automation can use `--verify --report <new JSON file>` or `--extract-to <new directory> --report <new JSON file>`. Automated extraction never launches the application. Automated replacement requires `--overwrite` and never terminates processes automatically. The GUI selects desktop shortcut creation by default and leaves launch after installation unchecked; both options are available under custom installation.
