# Message editing

[简体中文](README.md) | **English**

`@eduwork/dsh-message-edit` lets users change a message they already sent and resend it from there, like editing a message in the Codex App. After the edit is sent, the conversation continues from that message with the new content; the old messages and replies after it are no longer shown.

A DSH session log is append-only and cannot change in place, so the plugin uses DSH's native fork. It forks a new conversation just before the message, sends the edited message as the new conversation's next turn, and lets the new conversation take the original's place. The original is left unchanged and moved to the archive, where it can be restored. The plugin does not patch the DSH Runtime or UI bundles.

## Usage

A pencil button sits next to the copy button under each user message. Clicking it replaces the message bubble with an editor:

- Edit the text directly. Enter sends, Shift+Enter adds a line, Esc cancels. While an input method is choosing a candidate, Enter and Esc belong to it.
- The message's images and files are listed above the text and can be removed one by one. New files and images can be picked, pasted or dropped in. They upload to the current conversation first and are checked like the native composer's, so a refused file fails before any new conversation exists. With no text and no attachments left, sending is disabled.
- Conversations the message references (`@conversation`) stay referenced. The editor shows "Referenced conversations · …" under the text, matching the sent message. A reference is dropped when its text is changed, deleted or typed over. Whenever that cannot be told for certain the reference is dropped, so a reference the user removed is never sent.
- Once sent, the new conversation takes over: a title the user set is carried over, a pinned conversation stays pinned, anyone viewing the original moves to the new one, and the original is archived.

Particular cases:

- While a reply is generating, the pencil is unavailable; it works again once the reply finishes or is stopped.
- A message sent while a reply was generating (a steered message) cannot be edited on its own. It joined the turn partway, possibly after tools had run, and a turn cannot be restarted from its middle. Its row shows an unavailable pencil that points to the message that started the turn. Editing that message warns "This turn has N more message(s) sent mid-reply; sending replaces them too".
- Several messages of one conversation can be edited at once. When one edit is sent, drafts of messages the new conversation still has move to it, uploads in flight included; drafts of messages it no longer has close. One edit of a conversation is sent at a time; the other editors wait.
- Drafts and uploads survive scrolling the editor out of view and switching conversations.
- Subagent conversations get no pencil, nor does a Peer without fork or prompt access.

The plugin does not undo file changes or other actions already carried out; the editor says so.

## Installation

In a compatible DSH client, open the Plugins page, add `@eduwork/dsh-message-edit`, install and enable it. It requires DSH `>=0.2.2-rc.1 <0.2.3-0`; this version is verified on the official `0.2.2-rc.1` Runtime.

## Implementation

- **Host** (`src/index.js`, `src/remote.js`): the Typert Remote `eduworkMessageEdit/stageAttachments`. It re-stages attachments stored in the original conversation as upload receipts of the new conversation inside the Host, so their bytes never pass through the browser. As with DSH's own attachment reads, a stored reference is honoured within the caller's access to the conversations involved. The call reads from the original and writes to the new conversation, so access control checks both. Callers other than the owner can call it only when an access policy explicitly allows this method.
- **Client** (`src/client/`):
  - `index.jsx` forks, resends and replaces the original. The cut follows the rule the DSH Host applies when no cut is given (`fork-boundary.js`), and input queued before the cut is cleared before the send.
  - `editor.jsx` is the editor.
  - `drafts.js` keeps drafts and uploads outside React, because DSH's chat list is virtualized and unmounts rows.
  - `mentions.js` follows the references to other conversations.
  - `steering.jsx` adds the unavailable pencil to steered messages.

A few DSH interface details are relied on:

- User message action rows have no plugin slot. The pencil finds its row through the `conversation.chat.user.before` seat and is placed into the row's action bar (`[data-clock]`).
- DSH does not render that seat on steered rows, so their pencil comes from an always-mounted `shell.overlay` component that finds `data-chat-flow-kind="steering"` rows.

If DSH changes these structures the pencil may not show, but conversations themselves are unaffected.

## Development

Run in this package directory. Building and testing use the locked DSH Runtime:

```sh
npm ci
export EDUWORK_MESSAGE_EDIT_RUNTIME=../../third_party/dsh/candidate-v0.2.2-rc.1/npm-runtime
(cd "$EDUWORK_MESSAGE_EDIT_RUNTIME" && npm ci --ignore-scripts)
npm run check
```

The browser acceptance starts a separate DSH web app from that Runtime with a synthetic model and runs the main scenarios in headless Chromium:

- editing a middle message;
- generating and steered messages;
- removing and adding attachments;
- referencing other conversations;
- several editors;
- a reload afterwards.

It makes no live model requests and keeps the DSH data, HOME and default workspace inside its output directory. It needs a Chromium matching the Runtime's `playwright-core`:

```sh
node scripts/browser-test.mjs --output <new empty directory>
```
