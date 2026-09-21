# macOS application updates

[简体中文](MACOS_UPDATES.md) | **English**

Sparkle provides native checks, downloads, verification, installation and relaunch. Startup probes do not open a dialog. Users confirm downloads and installation; macOS may request authorization for a protected destination. Windows retains its portable updater. Configuration, sessions, credentials and Skills remain outside the app, and content updates remain available in the shared settings panel.

Older Mac builds without Sparkle require one manual replacement before this update path becomes available.

The public edition defaults to GitHub: `updates/macos/stable.xml` and `updates/macos/development.xml` provide appcasts pointing to GitHub Release assets. Publish and verify the assets first, then update the relevant feed through a PR. The development feed includes the newest development build and any newer stable release. Editions may configure their own feeds.

An edition may supply `resources/desktop/mac-updates.json`, or pass `-MacUpdateConfig <file>` to the Mac CI recipe. The schema contains `schemaVersion: 1`, HTTPS `feeds.stable` and `feeds.development`, and `publicEDKey` (the Base64 encoding of the raw 32-byte Ed25519 public key). No credentials or private keys belong in that file. CI verifies the pinned framework, compiles the native bridge and seals the application. Missing configuration disables application updates; incomplete configuration fails the build.

Channel preferences live in the user directory. The development appcast should offer the newest development or stable release; the stable appcast offers stable releases only. Switching channels must not downgrade. Assembly and appcasts share a version encoding: `0.3.6-dev.20260920.1` becomes `0.3.6dev20260920.1`, while stable remains `0.3.6`. Sparkle ignores hyphenated suffixes; native CI verifies this encoding with Sparkle's actual comparator.

Each distribution retains its own Ed25519 private key outside the repository. Sign the verified archive with:

```sh
node scripts/macos-update-feed.mjs sign app.zip release-receipt.json mac-updates.json private-key.pem https://downloads.example.org/app.zip appcast.xml
```

This only writes the appcast. It does not upload files, publish a GitHub Release or change an update channel. Upload the complete ZIP before its appcast; update the development feed when publishing a stable release too. Back up the private key securely and never include it in source, artifacts or logs.

EdDSA update verification does not replace Apple Developer ID signing or notarization. Initial launches of ad-hoc builds may still show macOS security prompts. Native CI uses disposable keys to test the real bridge, HTTPS probing, rejection of invalid signatures and in-place application replacement. Authorization dialogs, Gatekeeper and user interaction still require native user acceptance.
