# Optional conversation annotations

[简体中文](ANNOTATIONS.md)

The community [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) plugin (MIT) lets you select assistant passages, save multiple notes, and send them with a question.

Choose “Add plugin” in EduWork’s official plugin manager and enter `@changfenhuang/dsh-annotation@1.4.11`. Follow the reload prompt. The plugin is installed into the current user Profile and enabled optionally.

Select text → “Annotate” → enter and save a note → send a question. The composer shows the pending annotation count; `Annotation N` labels in replies link to quotes and notes.

Disable or uninstall through the same manager. Send or save pending notes first. Sent annotations remain conversation messages and may appear as ordinary text after disabling the plugin.

This candidate was tested with DSH `0.2.0-rc.2`. A [development patch and regression test](../third_party/dsh-annotation/README_EN.md) addresses toolbar positioning, message flashing, and duplicate instances in 1.4.11. Apply it separately; the default npm installation does not include it. Desktop acceptance of the patched version remains incomplete.
