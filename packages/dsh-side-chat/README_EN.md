# Temporary side chat

[简体中文](README.md) | **English**

Open a temporary side chat from a user message or completed assistant answer using the shared conversation components in the native right sidebar. Side chats inherit source history as model context through the standard seed fork mechanism; the UI hides inherited messages and shows only side-chat content.

Closing stops the session and discards messages and drafts. Switching conversations, collapsing the panel, hiding the window and inactivity do not end it. Refresh and window exit request a close; on abnormal termination the orphan remains only in memory until the Host exits. Explicitly requested file changes and external actions are not undone on close.

Each main conversation retains its own side chat. Switching restores its messages, draft and annotations. Promotion, nested branching, subagents, scheduled tasks and long-lived background work are unsupported. Tools follow the new session's permissions, and generation follows global concurrency rules.

## Architecture

This is a pure cordis plugin with no Runtime patches or experiment build pipeline.

- **Host** (`src/index.js` + `src/service.js`): creates seeded sessions via the standard `agents.create({ seed })` API; `/api/eduwork/side-chat` manages creation, ownership and cleanup
- **Client** (`src/client/`): registers sidebar tab, resource protocol, message action buttons; hides inherited messages via DOM
- **Boundary** (`src/boundary.js`): system prompt constraints and tool interception

## Local development

```sh
npm ci
npm run build
npm test
```

Run these commands in this package directory. See the [side chat proposal](../../docs/proposals/side-chat/README_EN.md) for product behavior.
