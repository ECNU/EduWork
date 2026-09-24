# Download institution configuration on first launch

[中文](PUBLISHER_BOOTSTRAP.md) · [Configuration file](CONFIGURATION_EN.md) · [Content updates](CONTENT_UPDATES_EN.md) · [Build guide](BUILD.md)

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

1. **Clean installation:** seed `config/eduwork.jsonc` with packaged update sources, verify and download defaults, and write them to that same file. Commit the revision only after desktop readiness.
2. **Download failure:** offer retry and signed offline import without deleting data.
3. **Existing installation:** read the local file directly without network dependency or a hidden overlay. Packaged bootstrap metadata initializes the file once; local sources, public keys and switches then take precedence.
4. **Legacy upgrade:** materialize the previously effective signed/legacy configuration. Remove unchanged obsolete version files and the old base cache after a successful startup, without scanning other installations or credentials.
5. **Updates:** merge untouched defaults, preserve local edits/additions/deletions, and report conflicting paths. Failed startup restores the only backup, `data/configuration/eduwork.previous.jsonc`, without accumulating copies.

Windows uses `<installation>/config/eduwork.jsonc`. macOS uses `~/Library/Application Support/<distribution>-electron/config/eduwork.jsonc` and never writes into `.app`. Signed downloads in `data/content-updates/` and fingerprints/transactions in `data/configuration/state.json` are internal state, not a hidden configuration layer. Syntax errors are reported rather than silently replaced from the network. See [configuration](CONFIGURATION_EN.md) for editing and recovery.

The portable Windows directory must be writable. Read-only files, file locks or insufficient disk space leave the same signed content retryable after the local problem is fixed and the app restarts. The startup window's retry and offline-import actions can also explicitly retry the highest received revision rejected by an older client, without deleting `data` or replacing the configuration manually. Recovery still checks publisher, channel, signature, hashes, dependencies and component revisions; it cannot install an older revision or different bundle at the same revision. Content that genuinely fails desktop startup is still rolled back and is not retried automatically.

## Offline delivery and publication

Publishers may also provide complete `desktop/publisher-bootstrap.win32.json`, `desktop/publisher-bootstrap.darwin.json`, or `desktop/publisher-bootstrap.linux.json` descriptors. The client prefers its platform file and falls back to the generic descriptor only when that file is absent. Invalid platform files fail instead of selecting another source. Platforms can manage configuration, Skills, revisions and compatibility independently. After initialization the selected source lives in the single `config/eduwork.jsonc`; changing bundled defaults does not overwrite a saved source.

`scripts/create-content-update.mjs` also generates `content-<revision>-offline.json` alongside the online manifest, content and receipt. Users can import this file from the first-run window. The same channel, signature, dependency, anti-rollback and startup checks apply. An unsigned JSONC file is not an offline package.

Validate signed content against target client versions, platforms and installed capabilities. Upload immutable content first, then update the channel's `latest.json`. Confirm clean installation before offering application downloads. Cover clean installation, offline restart, legacy upgrade and startup rollback. Platform-specific Skills require platform testing; removing a `platforms` restriction is not verification.

CI desktop startup uses isolated synthetic institution configuration, without a live school service. Synthetic tests cover first-run download, signature verification and recovery. Real login and native platform acceptance remain release requirements. This feature handles configuration delivery; macOS Developer ID signing, notarization and whole-app updates remain separate work described in the [Mac guide](MACOS.md).

## Migrating a retired configuration source

When a configuration protocol changes, the bundled descriptor may declare `migrateFrom: ["https://downloads.example.org/old-content"]`. Only a matching publisher and public key authorize migration. Custom sources, different keys, disabled configuration updates and explicitly selected test configurations are preserved.

The client verifies the old effective configuration, switches to the new source and requires a compatible signed configuration before starting the Host. Revisions are independent per source. Failed downloads can be retried; failed startup trials use the content transaction rollback. Local changes and additional organization entries survive. There is still one editable `config/eduwork.jsonc` and one backup. Older publisher installations without a content source also perform an initial download when this declaration is enabled.

Publish the new signed content first and retain the old source for old clients. Omit `migrateFrom` when no migration is needed.
