# Configuration file

[中文](CONFIGURATION.md) · [Examples](../config/desktop/examples/README_EN.md) · [Configuration and Skills updates](CONTENT_UPDATES_EN.md)

Generic and institution Electron editions read one effective file: `config/eduwork.jsonc`. Open it from Settings, edit and save, then fully quit the tray application and restart. Organizations, models, feature switches and media services come from this file, with no hidden institution overlay.

| Platform | Active file | Only rollback backup |
| --- | --- | --- |
| Windows portable | `<installation>/config/eduwork.jsonc` | `<installation>/data/configuration/eduwork.previous.jsonc` |
| macOS | `~/Library/Application Support/<distribution>-electron/config/eduwork.jsonc` | `data/configuration/eduwork.previous.jsonc` under the same distribution directory |

The generic distribution ID is `eduwork`. Mac configuration and user data stay outside `.app`. Passwords, API keys and login tokens remain in credential storage, not JSONC.

## Defaults and updates

Generic EduWork does not enable remote configuration by default. Institution editions may download signed defaults on first launch and write them to the same file. Once initialized, packaged bootstrap defaults no longer overwrite locally edited sources or settings.

Use Settings to check and download content updates. Downloads leave the active file unchanged until the next startup:

- Untouched defaults update automatically.
- Local edits, additions and deletions survive. Conflicting field paths are shown in the update panel.
- Lists of organizations, models and media providers merge by `id`, preserving custom entries.
- Remote content cannot change update sources, verification keys, product names or desktop preferences.

Automatic changes replace one fixed backup, `eduwork.previous.jsonc`; there are no versioned or timestamped backups. An unsuccessful content startup restores that backup while retaining edits made during the trial. To restore manually, quit and copy the backup to the active path. Syntax errors identify the file and line without silently resetting local configuration.

Legacy upgrades materialize the previously effective versioned/signed configuration into this file. After a successful startup, unchanged obsolete files identified during migration are removed. Other installations, history, credentials and personal models are not scanned or copied into configuration.

## UAT and local testing

Edit the organization parameters in `eduwork.jsonc`: `auth.discoveryUrl`, `auth.expectedIssuer`, `auth.clientId`, and endpoints/associations under `media.providers`. Identity-only OIDC instead uses `oidc.issuer` and `oidc.clientId`; legacy `keyBinding` is no longer supported. Required fields depend on the server protocol; use the matching example.

Set the existing `contentUpdates.configuration` field to `false` to freeze local configuration while continuing Skills updates. Set `contentUpdates.skills` to `false` as well to disable all remote content updates. Keep the existing source and public key rather than replacing the object with an incomplete one.

Software `updates` and configuration `contentUpdates` are separate. Development/stable release channels do not select UAT/production services. Local testing requires no edits to app resources or signed caches, and no separate UAT content server. A separate installation/data directory is recommended for sustained testing so accounts and conversations stay separate.

## Installed plugin settings

Optional `plugins` entries use the plugin ID from the edition composition, for example `"plugins": {"example-service": {"baseURL": "https://uat.example.test/v1"}}`. These options merge into that installed plugin on restart; they cannot install plugins. Unknown IDs fail with a configuration error. Use the edition/plugin documentation for accepted options. Institution service endpoints must be switched alongside account and media endpoints for UAT. Remote content configuration does not overwrite this local section.

## Internal state

`data/content-updates/` stores verified downloads. `data/configuration/state.json` stores revisions, field fingerprints and transactions for verification, merging and recovery. Neither is an additional active configuration file or a user editing surface.
