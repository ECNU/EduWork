# DSH Memory

Local memory and conversation recall for DeepSeek Harness.

**Package:** `@eduwork/dsh-memory` · **Source:** `EduWork/packages/dsh-memory` · [简体中文](README.md)

“Native” refers to DSH's plugin services; the same plugin supports DSH Web and desktop compositions. No institution account or cloud synchronization is required.

## Install

Version **0.1.1** requires Node.js 22.13+ and DeepSeek Harness **0.1.5-rc.1**. Align every DSH runtime package to that exact baseline; do not mix alpha or older rc packages into the Host. The plugin's stable version number does not change the upstream rc status.

Install the exact npm version:

```sh
dsh plugin --profile web add @eduwork/dsh-memory@0.1.1
dsh --profile web --dump-config
dsh --profile web
```

The previous `@eduwork/dsh-memory@0.1.0` targets DSH `0.1.2-rc.1`; upgrade the Host before installing 0.1.1. Do not install both versions in one profile.
The package includes a DSH bundle, Host, prebuilt Client and Remote descriptors; consumers do not need to compile it. Restart the selected profile after installation.

For development: `npm ci`, `npm run build`, `npm test`, then `npm pack --pack-destination artifacts` (create the directory first).
The build uses pinned public npm dependencies and does not require a DSH source checkout.

## User controls

Open Settings → Personalization. Local memory and reference-prior-chats are enabled by default. Automatic generation from tool-assisted chats is disabled by default; explicit requests may still store a fact with its source citation.

The manager has server pagination (10 records/page), search, edit, one-step edit undo, Retain / Stop retaining, Delete, and Forget and prevent relearning. Retained records survive age and capacity eviction. Deletion and forgetting take precedence; either can be undone for 30 seconds while the Host remains running. Deleting all records is irreversible and also removes suppression markers.

- `/memories on|off|reset`
- `/memories use|generate|search on|off|inherit`
- Tools: `memory_remember`, `memory_recall`, `memory_forget`, `memory_search_threads`, `memory_open_thread`.

The model decides when to save or search. This version has no separate background extraction/consolidation worker; similarly named compatibility settings do not imply that such a worker is implemented.

## Data and retrieval

Semantic records use the official storage-domain SQLite backend: domain `local_memory`, version 1, tables `records`, `session_policies`, `tombstones`. The bundle uses `$DSH_HOME/memory.sqlite3`. Default capacity is 400 records (configurable 16–10,000); ordinary unused records may be pruned after 30 days when a new record is written. User-retained and importance-3 records are protected. If every record is protected, new writes fail rather than evict protected data.

Semantic recall uses CJK-aware lexical matching and recency/importance/use signals. Historical conversation retrieval uses DSH's official Session Query service and its FTS5 derived index at `$DSH_HOME/session-query-memory.sqlite3`; original sessions remain in DSH's JSONL persistence. It returns bounded excerpts with `dsh-session:` references, not the entire archive.

Forget markers contain hashes, not prose. Matching is lexical and approximate: materially reworded facts may evade suppression. Markers currently have no count limit. Clearing memories does not delete original conversations.

Export/import uses `dsh-local-memory` JSON version 2, including semantic records, provenance and user retention; it excludes session logs and suppression markers. Moving exports therefore does not transfer the prevent-relearning list. Imports are bounded to 8 MB / 10,000 rows and remain subject to capacity rules.

## Upgrade an existing installation

Replace the old `@chatecnu-work/dsh-memory-native` entry; **do not load both packages**. Back up the existing DSH data directory before changing composition. Preserve the same DSH_HOME and existing database paths.

Preserve the existing instance IDs (the standalone bundle uses `local-memory` / `local-memory-sqlite`), `local_memory` domain v1, `memories` settings namespace and `localMemories` Remote service. The npm name is not part of the SQLite unit key.

DSH Session V3 is separate from the Memory domain and export versions. Historical session reads and supported log migrations remain owned by official DSH services. This plugin does not rewrite original session files or provide a user-directory import workflow.

An existing desktop composition that already declares storage routing should replace its Host row name and dependency only. Do not additionally enable this package's bundle on top of those same rows. Public exports retain `./core`, `./spec`, `./typert`, `./remote`, `./client` and `./package.json`.

## Verification and release

`npm test` covers lifecycle behavior, the browser module factory / Remote contract and synthetic legacy SQLite compatibility. To build and test the actual tarball against an isolated real DSH profile:

```sh
npx playwright install chromium
npm run verify
```

For a separately prepared runtime, use `npm run verify:runtime -- <runtime-root>` after installing this checkout's build/browser tooling. This creates a separate stage, checks direct DSH dependency resolutions and runs verification plus Session, prompt and query contracts there. Setting `MEMORY_RUNTIME` alone only selects the harness runtime; it does not redirect every static test import. For an already installed Edge browser, set `MEMORY_BROWSER_CHANNEL=msedge` (PowerShell: `$env:MEMORY_BROWSER_CHANNEL='msedge'`). Checks create synthetic profiles under ignored `artifacts/` and never use your normal DSH_HOME. The generated verification report records the actual Host version; npm audit covers the development dependency lock, not a separately prepared runtime. See [development and configuration](docs/development.md) for clean-install checks and configuration examples.

Module checks and npm publication use the shared EduWork workflow. See [package development and publication](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md).

MIT. See [NOTICE](NOTICE), [UPSTREAM.md](UPSTREAM.md) and [SECURITY.md](SECURITY.md).

Source, issues and PRs are maintained in [EduWork](https://github.com/ecnu/EduWork/tree/main/packages/dsh-memory). Run development commands from `EduWork/packages/dsh-memory`. npm installation remains independent. See [package publication](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md).
