# Windows portable extraction package

[中文](PORTABLE-EXTRACTOR.md)

This optional first-download asset is a ZIP containing one EXE. The EXE embeds the original Windows desktop release ZIP unchanged. It uses the product name and icon from that release and provides destination selection, progress, cancellation, and a launch button after extraction.

The extractor does not register an installation, create shortcuts, or change PATH or startup entries. The portable application's existing behavior determines where configuration and data are stored. Existing destinations are rejected. Application updates continue to use the existing updater.

## Build

Use Windows, PowerShell 7, and the Go toolchain pinned by `dsh-desktop/go.mod`:

```powershell
./scripts/pack-portable-extractor.ps1 `
  -Archive '<verified Windows release ZIP>' `
  -ExpectedSHA256 '<release ZIP SHA-256>' `
  -OutputDirectory '<new output directory>'
```

The input must contain the Electron product identity, brand icon, and `RELEASE-MANIFEST.json`. Outputs include `*-windows-x64-unpack.zip`, its SHA-256 sidecar, and a receipt recording the extractor source commit, dirty state, Go version, and payload and asset hashes. Public assets should use committed, clean source.

The builder does not reassemble the application or change the original release ZIP, application version, or update source. Keep the canonical `*-windows-x64-electron.zip` asset for existing updaters. Add the extraction package and verification files as separate assets on the same Release. Release notes remain subject to maintainer approval.

## CI and release pipelines

Windows candidate, development, and release recipes invoke `prepare-windows-portable-extractor.ps1` by default. It builds the extraction ZIP, reads and verifies its sole EXE, and uses that executable to extract the original release. Existing manifest, native runtime, and desktop launch checks then run against that output. A failed step prevents a successful receipt.

The `publish` directory contains both ZIPs, their SHA-256 sidecars, and receipts. The release publisher requires eight verified files and binds the extractor to the original ZIP, version, distribution, and clean core source commit before upload. Update manifests still reference only the original ZIP. Source Alpha workflows retain build artifacts only; public publication and release notes require maintainer approval.

Public and institution editions share this recipe. Institution repositories adopt it through `core.lock.json`, without copying the implementation. macOS builds do not produce the Windows extractor. Dedicated PR CI builds and extracts synthetic stable and development packages for both brands and checks that missing or modified publication files are rejected before upload.

## Validation and limits

- Verify the embedded ZIP SHA-256 and manifest identity, file count, paths, and sizes before extraction.
- Extract through Go file APIs with support for complete paths beyond the traditional 260-character limit. Check each file's CRC, size, and SHA-256.
- Extract into a private sibling staging directory, then rename it after verification. Clean only that staging directory on failure or cancellation; report its location if cleanup fails.
- Require a new local destination and check disk space and write access. The launch EXE's complete path must be shorter than 260 UTF-16 units. Internal files may exceed that length, but this does not guarantee arbitrary long-path support in every bundled third-party tool.
- No overwrite mode or forced elevation. Embed `asInvoker` and `longPathAware` without modifying Windows registry settings.
- The outer ZIP simplifies delivery and avoids Explorer expanding deep application directories. It does not guarantee antivirus acceptance. The build script does not perform Authenticode signing.

Automation can use `--verify --report <new JSON file>` or `--extract-to <new directory> --report <new JSON file>`. Automated extraction never launches the application. The GUI launches it only when the user clicks the launch button after successful extraction.
