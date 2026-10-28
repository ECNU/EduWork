# Official browser adapter

[简体中文](README.md) | **English**

The current pinned DSH product uses official Playwright MCP tools. This adapter binds the bundled Chromium, preserves public interaction confirmations and guards unsafe host code. Upstream owns navigation, JavaScript, session isolation and process cleanup.

Public `eduwork-search` remains independent: DeepSeek search when its key is configured, otherwise Bing/Baidu. Neither the search provider nor the conversation model changes with this migration.

The browser keeps the `eduwork-browser` entry ID and saved activation choice. The old interactive provider is no longer mounted. The `browser` skill switch controls guidance visibility; the plugin switch controls browser tools. Disabling the skill does not revoke tool permissions.

Disabling the plugin removes existing browser tools. After enabling it again, restart the app before continuing an existing conversation; there is no need to delete its history. Upstream mounts tools when a session's Agent is created and does not attach them to Agents that are already running.

## Configuration

- `executablePath`: optional, isolated browser only. Desktop builds use bundled Electron Chromium through `DSH_MEDIA_BROWSER`; standalone Hosts without that binding use upstream browser discovery. Missing explicit executables fail.
- `headless`: `true` by default, isolated browser only. Users may set `false` for a visible managed window, then recreate the session. Per-action mode switching from the old tool is unavailable.
- `toolCallTimeoutMs`: 120000 by default, between 1000 and 300000.

Outside Full Access, reading pages, switching tabs and opening public addresses need no confirmation. Interactions, screenshots and private-target navigation ask each time, and the prompt names the action, such as the element to click, the text to type or the address to open. `browser_run_code_unsafe` requires Full Access, enforced by the terminal tool guard. Treat page contents as untrusted data.

For subagents, Web and CLI, each session owns an isolated browser, separate from the sidebar and system browser. Login persistence across restarts is not guaranteed. Inspect the page after interruption instead of replaying submissions. This adapter does not implement remote SSH browsers or computer use.

## Desktop sidebar

In the desktop app, a conversation's own Agent drives the browser tabs in that conversation's right sidebar. Users watch every step, can stop the Agent to take over at any time, and complete logins or CAPTCHAs on the same page.

- Open tabs belong to the user. The Agent may read them; clicks and typing keep the confirmations above. Unrelated browsing happens in a new tab.
- The tab being driven shows a blue border and "Agent is browsing · Stop". While the Agent's turn runs, the user can watch that tab but not act on it, so the two never act at once. To take over, the user clicks Stop, which works like the Stop button by the message box, or waits for the turn to end, as when the Agent asks them to log in, then tells the Agent to continue. The sidebar expands once when the Agent starts; if the user then collapses it, the Agent continues collapsed, and only a new tab expands it again.
- The Agent's clicks and tab switches leave the user's focus where it was, such as a message being typed or a page in another conversation.
- While the conversation is not on screen in the desktop app, because the user views another conversation or uses it from their phone, the Agent can still drive the open tabs, and new pages open in the background: they work the same and share the sidebar's logins, but the user cannot see them, and they close when the Agent closes its browser or leaves. Pages that a link in a sidebar tab opens in a new window still load only once the user returns to the conversation.
- Only the local Host process receives the connection address. The Agent sees only its conversation's tabs, and pages cannot use it to reach the application window, other conversations or cookie storage.
