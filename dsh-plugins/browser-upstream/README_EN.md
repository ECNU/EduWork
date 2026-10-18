# Official browser adapter

[简体中文](README.md) | **English**

The current pinned DSH product uses official Playwright MCP tools. This adapter binds the bundled Chromium, preserves public interaction confirmations and guards unsafe host code. Upstream owns navigation, JavaScript, session isolation and process cleanup.

Public `eduwork-search` remains independent: DeepSeek search when its key is configured, otherwise Bing/Baidu. Neither the search provider nor the conversation model changes with this migration.

The browser keeps the `eduwork-browser` entry ID and saved activation choice. The old interactive provider is no longer mounted. The `browser` skill switch controls guidance visibility; the plugin switch controls browser tools. Disabling the skill does not revoke tool permissions.

Disabling the plugin removes existing browser tools. After enabling it again, restart the app before continuing an existing conversation; there is no need to delete its history. Upstream mounts tools when a session's Agent is created and does not attach them to Agents that are already running.

## Configuration

- `executablePath`: optional. Desktop builds use bundled Electron Chromium through `DSH_MEDIA_BROWSER`; standalone Hosts without that binding use upstream browser discovery. Missing explicit executables fail.
- `headless`: `true` by default. Users may set `false` for a visible managed window, then recreate the session. Per-action mode switching from the old tool is unavailable.
- `toolCallTimeoutMs`: 120000 by default, between 1000 and 300000.

Outside Full Access, interactions, screenshots and private-target navigation retain confirmation. `browser_run_code_unsafe` requires Full Access, enforced by the terminal tool guard. Treat page contents as untrusted data.

Each session owns an isolated browser, separate from the sidebar and system browser. Login persistence across restarts is not guaranteed. Inspect the page after interruption instead of replaying submissions. This adapter does not implement remote SSH browsers or computer use.
