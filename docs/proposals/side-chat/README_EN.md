# Side Chat

[简体中文](README.md) | **English**

Open a side chat from a message or text selection in the main conversation, and continue in a separate composer in the right sidebar. Each side chat starts from a source-history snapshot at the selected boundary. Inherited history provides model context and is hidden in the side-chat view. The main and side chats generate and stop independently.

A main conversation may have multiple side chats. A reference goes to the focused side chat when its snapshot covers the selection; otherwise, the first eligible chat in creation order is used. A new side chat is created when none of the existing snapshots covers the selection.

For example, with snapshots A, B and C from oldest to newest, content introduced in C goes to C. For content already present in B, use the focused B or C if applicable; otherwise choose the first of B and C in creation order. Content newer than C opens a new side chat.

Selections from a streaming reply carry the visible context at selection time; see the [plugin guide](../../../packages/dsh-side-chat/README_EN.md) for the limits on long content and source context. Closing a side chat stops generation and archives it, preserving history for later viewing or restoration. A forced exit may leave an unarchived ordinary session.

Side chat and annotations are independent plugins. Closing uses the public DSH Workspace archive interface without modifying the DSH Runtime or UI bundles. The view hides inherited history using native DOM markers; KV cache reuse is determined by the model service.
