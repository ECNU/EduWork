# 变更记录 / Changelog

## 0.1.0 — Unreleased

- 首个版本：用户消息旁的铅笔按钮打开编辑框，改过的消息从 DSH 原生分叉的新对话里重新发送，新对话接替原对话（保留用户设置的标题和置顶），原对话移进归档。
- 原消息的图片和文件可以逐个移除，也可以选择、粘贴或拖入新的附件；附件在主机内重新登记到新对话，访问控制同时检查原对话和新对话。
- 消息里引用的其他对话保留到编辑后的消息，用户改动或删除引用文字时去掉。
- 生成中不能编辑；插话不能单独编辑，编辑这一轮开头的消息时提示插话会一起替换。
- 同一对话可以同时编辑多条消息，草稿在滚动、切换对话和对话被替换后保留；同一对话一次只发送一条编辑。
- Initial release: a pencil next to each user message opens an editor; the edited message is resent in a new conversation forked natively by DSH, which takes the original's place (keeping a title the user set and the pin), and the original is archived.
- The message's images and files can be removed one by one, and new attachments picked, pasted or dropped in; attachments are re-staged into the new conversation inside the Host, with access control checking both conversations.
- Conversations the message references stay referenced in the edited message, and are dropped when the user changes or deletes the reference text.
- Messages cannot be edited while a reply generates; steered messages cannot be edited on their own, and editing their turn's first message says they are replaced too.
- Several messages of one conversation can be edited at once; drafts survive scrolling, switching conversations and the conversation being replaced; one edit of a conversation is sent at a time.
