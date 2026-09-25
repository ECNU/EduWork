# Workbench services

[简体中文](README.md)

Provides generic skill management, desktop updates and diagnostics. The skill center reads actual skill directories without requiring an institution account; desktop operations reuse authenticated host-boundary services.

## Skill entry

DSH 0.1.7 exposes Skills under the sidebar's Plugins page through the official `plugins.item` slot and back navigation. Search, toggles, import, creation, personal-skill removal and current-project discovery reuse the same service. List summaries do not load the skill catalog, and Settings no longer duplicates the skill tab. DSH 0.1.5 keeps Settings → Plugins → Skills.

## Updates and diagnostics

A small blue button appears at the lower left when an update is available, shows download progress, and offers restart/install when ready. Settings and tray actions open the same panel; closing it does not stop a download.

The Check for updates action is aligned to the right of the settings heading. Development and public-beta channels use theme-colored buttons; conflicting actions are disabled while busy. Switching channels neither downgrades the app nor changes its installed-version badge. The development channel also receives newer public-beta versions. Diagnostic exports include component, startup and update information plus redacted logs; conversation bodies are exported separately.

## Import history

Select the old client's application root, including `data/`, and exit that client first. Supported layouts include `data/dsh` and Wails/Electron distribution data directories. Logs are copied to isolated staging and read through official JSONL/Zstd persistence APIs. Old plugins are never executed.

Import merges sessions, internal workspaces and attachments. Duplicates are skipped, conflicting sessions receive a new ID, and conflicting files are retained as separate copies. When an external workspace is missing on another machine, history is preserved with an empty workspace placeholder and a request to copy the source files separately. Configuration and login remain unchanged. Browser caches, logs and Memory databases are outside this import scope.

Directory selection uses official `uiWorkspace.pickDirectory` or Go `Startup.PickDirectory`. `inspectImport` returns the inspection state; a `ready` result may be confirmed through `importData(id)` or cancelled. Only staging is used before confirmation. Compatibility is determined from log headers and record-body versions. Unknown versions produce explicit errors, without silently skipping them or substituting an older copy for an unreadable new log. Results are saved under `dsh/imports`; reopen the session after the current task finishes.

When DSH 0.1.7 imports v0–v3 logs, it first collects direct children and their own descriptors per source data directory, then uses the official migration API to produce v4. Fork-inherited descriptors are excluded from the child's own evidence. Inspection never modifies source files. A corrupt child is reported separately; if its header is readable, its parent retains an explicit unknown-child entry. Source file or directory changes during inspection require another inspection.

## Model requests

The setting controls total concurrency for this Host, defaulting to 3 across main conversations, subagents and auxiliary requests. Legacy subagent limits migrate to total concurrency; see [concurrency control](../request-concurrency/README_EN.md).

## Verification

Set `EDUWORK_TEST_RUNTIME` to a prepared DSH runtime and run `node --test test/*.test.mjs`. `test/import-browser.mjs` uses the real React interface, strict import schemas and Edge, with TypeScript tooling prepared in `main.cache/client-build-tools`. Tests use synthetic data only.
