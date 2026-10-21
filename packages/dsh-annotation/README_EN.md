# Selection Quotes and Notes

[简体中文](README.md)

`@eduwork/dsh-annotation` is an optional DSH plugin. Select text in a completed response, add a note, see numbered annotations below the source response, and send them with your question. References, draft persistence, and submission use native DSH mechanisms.

## Installation

On the EduWork Plugins page, choose “Add plugin”, enter `@eduwork/dsh-annotation`, install and enable it. Disable or remove it on the same page.

Requires a DSH client providing the official Chat view and composer extensions (`>=0.2.1-rc.2 <0.3.0-0`). Sent annotations above the bubble also require EduWork's `conversation.chat.user.decorate` extension seat; clients without it display the original message text.

## Usage

1. Select text in the final response of a completed turn and click the “＋ Annotate” button.
2. Write a note (optional), then click “Add to message” or press Enter; Shift+Enter inserts a newline. During IME composition, Enter confirms the candidate only; press Enter again after composition to add the note.
3. Numbered annotations appear below the source response. The composer retains its native references and shows “N annotations”. Click a number, reference, or summary entry to view the full quote, edit, or delete a note.
4. Add more annotations and send them together with your question, or send annotations alone. The current draft's numbers and count clear after submission.
5. Sent messages show “Annotation 1, 2…” above the bubble. Hover, click, or focus a number to view its quote and note. The bubble displays only the question; annotation-only messages create no empty bubble.

References are saved with the draft and can be mixed with ordinary text and file references. Reloading restores pending annotations and source numbers. Numbers follow the current composer order; deletion and native Undo update both views. Sending uses the client's native flow, so queueing or steering into a running turn follows your settings.

Editing a note preserves other composer content. Cancel keeps the original note, and changing focus does not dismiss an unfinished edit. If the reference changed or the composer is in command/submission mode, editing or deletion is rejected and your input stays available for retry. Read-only previews close on outside clicks, window changes, or Escape.

If the composer cannot accept a reference yet, the editor keeps the quote and note for retry. Floating controls follow the selected text as you scroll and as the layout changes, for example when an image loads.

## Scope

- Numbers appear below the source response and scroll naturally with it. Selected words do not receive persistent highlights or floating numbers.
- Pending numbers appear below the source response. Sent annotations are reconstructed from a structured prefix in the user message and displayed above that message's bubble, without a separate annotation database.
- New annotations target final responses of completed turns in official Chat, not streaming content, tool output, user input, or sidebar files.
- Quotes are complete snapshots. New references also retain source message IDs and up to 320 visible characters before and after the selection, without implying access to the full source. Quotes remain viewable and sendable when the source is not loaded. Older references without source metadata stay compatible; existing Markdown quote messages remain unchanged.

## Development

```sh
node scripts/packages/manage.mjs install dsh-annotation
node scripts/packages/manage.mjs check dsh-annotation
```

The plugin adds UI through official `conversation.chat.turnTail`, `conversation.input.left`, and `conversation.input.overlay` slots. Pending notes and their order come from public `InputState.occurrences`; editing and deletion use revision-guarded native input span operations, without changing Lexical directly or replacing the entire draft. `src/client/draft.js` isolates reference-coordinate conversion and source resolution through public Chat snapshots.

Selection reads the official Chat row's `data-chat-node-key` to identify its message and uses DOM Range to capture bounded surrounding text in that row. There is no message DOM rewriting or global text matching. Hosts with different Chat row markup must revalidate this adapter rather than guess the source.

On submission, the reference codec emits versioned intermediate fragments. The host's `agent/pre-step` hook gathers them within each user message into one fixed prompt, `<eduwork-response-annotations>` JSON, and the question body. Role, message ID, attachments, and native Queue/Steer behavior are preserved. JSON escapes XML boundaries and native reference symbols; selections and context are explicitly quoted source material. Retries do not wrap an envelope twice.

The renderer projects message text without deleting persisted content. Numbers, quotes, notes, and context are restored from the message itself. Unknown versions, malformed data, and code examples remain visible. `src/protocol.js` implements the shared send/display protocol. `scripts/patch-chat-user-content-runtime.mjs` adds a generic decoration seat to a copy of the pinned Runtime and records the patch in the build receipt. Native components still own body text, attachments, and message actions.

License: MIT.
