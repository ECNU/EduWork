# Selection Quotes and Notes

[简体中文](README.md)

`@eduwork/dsh-annotation` is an optional DSH plugin. Select text in a completed response, add a note, see numbered annotations below the source response, and send them with your question. References, draft persistence, and submission use native DSH mechanisms.

## Installation

On the EduWork Plugins page, choose “Add plugin”, enter `@eduwork/dsh-annotation`, install and enable it. Disable or remove it on the same page.

Requires a DSH client providing the official Chat view and composer extensions (`>=0.2.1-rc.2 <0.3.0-0`).

## Usage

1. Select text in the final response of a completed turn and click the “＋ Annotate” button.
2. Write a note (optional), then click “Add to message” or press Enter; Shift+Enter inserts a newline. During IME composition, Enter confirms the candidate only; press Enter again after composition to add the note.
3. Numbered annotations appear below the source response. The composer retains its native references and shows “N annotations”. Click a number, reference, or summary entry to view the full quote, edit, or delete a note.
4. Add more annotations and send them together with your question, or send annotations alone. The current draft's numbers and count clear after submission.

References are saved with the draft and can be mixed with ordinary text and file references. Reloading restores pending annotations and source numbers. Numbers follow the current composer order; deletion and native Undo update both views. Sending uses the client's native flow, so queueing or steering into a running turn follows your settings.

On submission, the plugin formats each annotation as a numbered excerpt, optional comment, and source message ID, with one set of instructions asking the AI to address every comment and label corresponding answers, for example `[Annotation 1]`. Excerpts without comments supply context without inventing a question. Numbers match the current composer order. This is a prompting convention: model compliance can vary, and answer labels are ordinary text rather than clickable links. Copying to another application retains the concise quoted-text format.

Editing a note preserves other composer content. Cancel keeps the original note, and changing focus does not dismiss an unfinished edit. If the reference changed or the composer is in command/submission mode, editing or deletion is rejected and your input stays available for retry. Read-only previews close on outside clicks, window changes, or Escape.

If the composer cannot accept a reference yet, the editor keeps the quote and note for retry. Floating controls follow the selected text as you scroll and as the layout changes, for example when an image loads.

## Scope

- Numbers appear below the source response and scroll naturally with it. Selected words do not receive persistent highlights or floating numbers.
- Only the current unsent draft is managed. Sent quotes remain as text in the conversation; there is no separate historical annotation database.
- New annotations target final responses of completed turns in official Chat, not streaming content, tool output, user input, or sidebar files.
- Quotes are complete snapshots. If the source belongs to another session or is not loaded, the quote remains viewable and sendable from the composer. Older references without source metadata remain viewable, editable, and sendable.

## Development

```sh
node scripts/packages/manage.mjs install dsh-annotation
node scripts/packages/manage.mjs check dsh-annotation
```

The plugin adds UI through official `conversation.chat.turnTail`, `conversation.input.left`, and `conversation.input.overlay` slots. Pending notes and their order come from public `InputState.occurrences`; editing and deletion use revision-guarded native input span operations, without changing Lexical directly or replacing the entire draft. `src/client/draft.js` isolates reference-coordinate conversion and source resolution through public Chat snapshots.

Selection reads the official Chat row's `data-chat-node-key` to identify its message. This is the sole message-DOM adapter: no message DOM rewriting, send interception, or global text matching. Hosts with different Chat row markup must revalidate this adapter rather than guess the source.

`src/client/prompt.js` formats model input through the official `ReferenceCodec.serialize`. It weakly keys numbering and the once-per-attempt instructions by the native submission's `AbortSignal`, relying on DSH 0.2.1 invoking codecs in document order. Revalidate duplicate references, retries and concurrent-session ordering when upgrading the host. It does not infer indices from an active session, alter drafts, intercept submission or maintain another annotation history. Only existing message IDs are sent; session IDs and guessed text offsets are omitted.

License: MIT.
