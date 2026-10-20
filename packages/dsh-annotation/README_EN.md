# Selection Quotes and Notes

[简体中文](README.md)

`@eduwork/dsh-annotation` is an optional DSH plugin. Select text in a conversation, choose “Annotate” and add an optional note; the passage is inserted into the composer as a reference. When sent, it expands into the quoted text and note, followed by your question.

## Installation

On the EduWork Plugins page, choose “Add plugin”, enter `@eduwork/dsh-annotation`, install and enable it. Disable or remove it on the same page.

Requires a client compatible with the DSH 0.2 API series (`>=0.2.0-rc.2 <0.3.0-0`).

## Usage

1. Select text in a conversation and click the “＋ Annotate” button that appears.
2. Write a note (optional), then click “Add to message” or press Enter; Shift+Enter inserts a newline. During IME composition, Enter confirms the candidate only; press Enter again after composition to add the note.
3. A reference appears in the composer; click it to view the quote and note; click outside the preview or switch windows to dismiss it. Type your question and send.

References are saved with the draft and can be mixed with ordinary text and file references. Sending uses the client's native flow, so queueing or steering into a running turn follows your settings. To change a note, remove the reference and quote again.

## Development

```sh
node scripts/packages/manage.mjs install dsh-annotation
node scripts/packages/manage.mjs check dsh-annotation
```

License: MIT.
