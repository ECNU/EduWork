# Download institution configuration on first launch

[中文](PUBLISHER_BOOTSTRAP.md) · [Content updates](CONTENT_UPDATES_EN.md) · [Build guide](BUILD.md)

An institution edition can distribute the Electron archive produced by GitHub CI without repacking it. The app carries its edition identity, update feeds and a verification public key; it downloads institution configuration at first launch. Windows and macOS share this implementation. A separate configuration PKG is unnecessary for this mode.

The generic edition continues to read user configuration and never contacts an institution feed by default. Publisher bootstrap is an explicit edition choice; deploying generic EduWork with local configuration remains supported.

## Enable bootstrap

Set `ownership: "publisher"` in the edition resource `desktop/configuration-policy.json`. Include `desktop/publisher-bootstrap.json` through the distribution's `resources` list. The descriptor permits only these top-level fields:

```json
{
  "schemaVersion": 1,
  "updates": {
    "provider": "static",
    "manifestURL": "https://downloads.example.org/app/development/latest-windows-amd64.json"
  },
  "contentUpdates": {
    "publisher": "example",
    "baseURL": "https://downloads.example.org/content",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n<Ed25519 SPKI public key>\n-----END PUBLIC KEY-----\n",
    "configuration": true,
    "skills": true,
    "bundled": { "configuration": 0, "skills": 0 }
  }
}
```

Replace the placeholder with a real public key. `updates` uses the existing [software update protocol](UPDATES.md); `contentUpdates` supplies signed configuration and Skills. A channel in a software feed URL locates the feed, not the user's preference. Desktop packaging controls `UpdateDefaultPolicy`; macOS defaults to `development` for development versions and `stable` otherwise. The descriptor must not specify `defaultPolicy`. Saved user preferences take precedence.

Configuration management must be enabled and its bundled revision must be zero. Skills can remain bundled (`skills: false`) or be managed remotely. The latest signed manifest must include every enabled component as a complete snapshot. Each supported channel needs a compatible manifest before new installations are offered on that channel.

The bundled `desktop/eduwork.jsonc` contains only public branding, an empty organization list and safe defaults. Client IDs, model catalogs and media endpoints belong in signed content. Never distribute passwords, client secrets, personal API keys, login tokens or signing private keys. Downloaded client configuration is not confidential merely because it is absent from the source repository.

## Startup and recovery

1. **Clean installation:** download and verify signatures, size, digest, components and dependencies before starting the workbench. Commit the content revision only after desktop readiness.
2. **Download failure:** offer retry and signed offline import without deleting data or requiring reinstallation.
3. **Existing installation:** start from verified cached content without waiting for the network. Check for updates in the background; failures retain existing configuration.
4. **Legacy upgrade:** consider versioned configurations no newer than the running app in the original configuration directory, then legacy `eduwork.jsonc`. Copy only organization, feature and media settings, preserving the close-window preference. Do not modify originals, scan other installations or copy credential stores. Feed and key always come from the new app.
5. **Startup failure:** roll back uncommitted content to the prior revision or legacy configuration. With no fallback, wait for corrected content instead of retrying the failed revision forever. A damaged committed configuration may be restored from identical signed bytes without lowering the revision.

Windows stores bootstrap and signed content caches under the installation's `data/publisher-bootstrap/<source-id>/` and `data/content-updates/<source-id>/`. macOS uses matching directories under `~/Library/Application Support/<distribution>-electron/data/`. The source ID binds edition, publisher, URL and public key. Nothing writes into `.app`. Remote content cannot replace its trust root. Effective configuration overlays authenticated content on the base cache; an old JSONC file alone does not describe the active model configuration.

## Offline delivery and publication

`scripts/create-content-update.mjs` also generates `content-<revision>-offline.json` alongside the online manifest, content and receipt. Users can import this file from the first-run window. The same channel, signature, dependency, anti-rollback and startup checks apply. An unsigned JSONC file is not an offline package.

Validate signed content against target client versions, platforms and installed capabilities. Upload immutable content first, then update the channel's `latest.json`. Confirm clean installation before offering application downloads. Cover clean installation, offline restart, legacy upgrade and startup rollback. Platform-specific Skills require platform testing; removing a `platforms` restriction is not verification.

CI desktop startup uses isolated synthetic institution configuration, without a live school service. Synthetic tests cover first-run download, signature verification and recovery. Real login and native platform acceptance remain release requirements. This feature handles configuration delivery; macOS Developer ID signing, notarization and whole-app updates remain separate work described in the [Mac guide](MACOS.md).
