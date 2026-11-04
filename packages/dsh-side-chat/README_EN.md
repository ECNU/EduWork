# Temporary side chat

[简体中文](README.md) | **English**

Open a temporary side chat from a user message or completed assistant answer using the shared conversation components in the native right sidebar. Side chats inherit source history as model context through the standard seed fork mechanism; the UI hides inherited messages and shows only side-chat content.

Closing stops generation and archives through DSH's public Workspace API. Durable history and Workspace membership remain available for viewing or restoration as an ordinary conversation, including inherited source history. Switching conversations, collapsing the panel, hiding the window and inactivity do not end it. Refresh and window exit request archival; forced termination may leave an unarchived ordinary conversation. Draft restoration is not guaranteed. File changes and external actions are not undone.

Each main conversation can retain multiple side chats, each with a fixed snapshot of its source history. A reference goes to the focused side chat if its snapshot covers the selection; otherwise the first eligible chat in creation order is used, or a new snapshot is created. Live selections use a captured visible-text snapshot as quoted context; above 100,000 characters only the selection and nearby context are retained and a fresh side chat is created. Switching restores each chat, its messages, draft and annotations. Promotion, nested branching, subagents, scheduled tasks and long-lived background work are unsupported. Tools follow the new session's permissions, and generation follows global concurrency rules.

In EduWork, conversations created as side chats do not send completion or failure notifications, including after archival and restoration as ordinary conversations. Approval requests and questions that need user input still notify.

## Installation and usage

Add `@eduwork/dsh-side-chat` on the Plugins page of a compatible DSH client, then enable it. The plugin requires the session, Workspace archiving and right-sidebar APIs in DSH `>=0.2.1-rc.3 <0.3.0-0`; this version is verified against the official `0.2.1-rc.3` Runtime.

1. Below a user message or a completed assistant response in the main conversation, click **Open side chat**.
2. Enter a question in the right pane. The side chat inherits a history snapshot through that message and continues independently.
3. Closing the side chat stops generation and archives it. Collapsing the sidebar does not close it.

With `@eduwork/dsh-annotation >=0.1.1 <0.2.0`, the same selection toolbar also offers **Ask in side chat**. The excerpt enters the side composer's draft as an annotation that can be edited, removed or combined with more excerpts before sending. Intermediate and streaming assistant text can also seed side-chat questions; ordinary annotations still target completed final responses.

Annotation is an optional companion package; install and enable it separately. Without it, the message action still opens side chats. Disabling side chat leaves annotation working independently. Both plugins can be enabled or disabled separately in the plugin manager.

## Architecture

This cordis plugin does not modify Runtime or UI bundles. Closing calls `workspaceRegistry.archiveSession` without inspecting or deleting backend files. Hiding inherited history still depends on native DOM markers. The host must provide the Workspace archive service.

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
