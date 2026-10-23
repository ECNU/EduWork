# Side chat proposal

[简体中文](README.md) | **English**

Status: **Planned, pending review; not implemented.** This proposal defines intended behavior and implementation boundaries. It does not describe an available feature.

## Goal and interaction

Users can choose “Open side chat” on any user or assistant message in an existing conversation and ask follow-up questions in a right panel while keeping their place in the original conversation. For example, they can discuss a grading rubric beside a course-planning conversation without interrupting its subsequent planning work.

A side chat has a new session ID, its own input, generation state and cancellation controls. Its header shows a temporary-chat label, a source-message link, Close and “Save as conversation.” It is an independent conversation controlled directly by the user, rather than a delegated subagent. Results are not automatically sent back to the original conversation.

## Differences from ordinary conversations

| Aspect | Side chat before saving | Ordinary conversation, including a saved side chat |
| --- | --- | --- |
| Starting context | Snapshot of the source through the selected message | Empty when newly created, or the complete context retained when saved |
| Display | Temporary panel beside the source | Main conversation area |
| Organization and discovery | Excluded from conversation lists, folders, search, recents and automatic history-memory indexing | Managed under existing conversation rules |
| Lifetime | Deleted on explicit close; not restored after restart | Retained when its view closes; requires explicit deletion |
| Models and tools | Reuses ordinary capabilities, permission rules and global concurrency limits | Existing execution rules |
| Saving | User explicitly chooses a folder to retain it | Persisted normally |

## Proposed initial scope

1. **History cutoff.** Inherit the currently visible branch from its beginning through the selected message, inclusive, with no later messages. Subsequent additions, edits and regenerations in either conversation do not affect the other. Inherited history is initially collapsed and can be expanded. Selecting a user message does not automatically replay its request; the user sends a new follow-up.
2. **Message boundaries.** Provide the action on every user message and completed assistant message, excluding internal tool events as separate entry points. A streaming assistant message must complete or stop first to avoid copying partial output or incomplete tool calls. Historical tool calls and results must form valid context and must never be executed again. Long histories follow ordinary context-compaction rules with a visible indication when compaction is used; sending every original word on every request is not guaranteed.
3. **Independent execution.** Start with the source conversation’s current model and Agent preset, allowing later independent changes. Main and side chats can generate concurrently and stop independently. Evaluate permissions for the new session without copying one-time approvals, active tasks, pending approval requests or subagents. Preserve usable attachment content and references, and explicitly report unavailable content; copying a display card alone does not count as carrying its content.
4. **Closing and navigation.** Initially allow one temporary side chat per client window. Navigating away from the source or opening an artifact preview hides the panel while retaining temporary state; returning restores it. Collapsing is distinct from closing. Opening another side chat requires an explicit choice to save the existing one or close and discard it. Closing the panel, its owning window or the client ends the temporary session; refresh and abnormal restart do not restore it. Narrow windows may use an overlay with the same lifetime.
5. **Disappear on close.** Immediately revoke access to the temporary session, cancel its generation, queued requests and owned background tasks, then clean up its messages, draft and exclusive caches. A temporary namespace in existing session storage is acceptable, but it must remain outside ordinary indexes. Reclaim crash leftovers on next startup. Delete only exclusively owned temporary data, preserving source attachments. External effects such as sent mail or modified work files are not undone, and temporary chat does not promise that providers retain no requests.
6. **Explicit saving.** “Save as conversation” allows title editing and selection of any accessible conversation folder, including unfiled. Save inherited history, new messages and required attachments, retain the session ID, and open it as an ordinary conversation. Closing its view thereafter does not delete it. Failure or cancellation leaves it temporary and retryable. Finish or stop generation before saving; prevent concurrent closing during commit, and make repeated saves idempotent.
7. **Folder versus working directory.** Folder selection changes conversation organization without implicitly moving files or changing tool working directories. If existing folders bind to project working directories, explain this and reuse project migration rules, verifying attachments and paths before declaring success. Temporary chats initially use the source working directory, so both conversations may modify the same files; independent conversations do not imply filesystem isolation.
8. **Source and memory.** Source metadata supports navigation rather than being the sole means of reading inherited history. Snapshots and saved conversations remain usable after source edits or deletion. Temporary chats do not automatically enter long-term memory or become searchable by other conversations. Explicit user requests to write external files, knowledge bases or memory follow existing permissions and are not undone on close.

The initial version excludes multiple side panels, branching within a side chat, automatic merge-back, cross-device temporary-chat synchronization and crash recovery. Save the conversation for long-term retention.

## Implementation assessment

**Feasible, with an expected medium-to-large change across layers.** The repository uses the pinned DSH `0.2.1-rc.2` Runtime and already has conversation UI slots, session scopes and artifact-side-panel integration. These provide integration points, but support for safe branching at arbitrary messages, two complete chat panels, isolated temporary storage and atomic saving has not been verified. Existing slots do not establish feature readiness.

Reuse ordinary message projections, input, model execution, tool permissions and attachment services, adding an explicit temporary lifecycle. The UI owns only the action and panel. The temporary marker must reach backend session queries, search, memory scans, export and notification routing; hiding list entries in the frontend is insufficient. Change lifecycle state only after permanent storage and attachment references commit successfully. Cleanup and saving must share state constraints to prevent deletion races or duplicate saves.

Before implementation, inspect branching, session mounting and persistence interfaces in the pinned Runtime. Verify valid snapshots from user messages and assistant messages containing tool results, and establish how conversation folders relate to working directories. If required interfaces are missing, coordinate DSH extension contracts before integrating EduWork. Preserve existing npm and component locks; do not deliver through edits to installed official packages or a second chat engine. Reuse existing layout facilities when allocating space between artifact preview and chat.

## Planned acceptance checks

- Branch from earlier user, assistant and tool-bearing messages; verify cutoff, attachments and context. Later source changes must not leak in, and historical tools must not replay.
- Verify concurrent generation, independent cancellation, navigation, artifact preview, collapse and explicit close. Search, memory and restart must not recover closed temporary chats.
- Stop owned tasks on close. Failed cleanup remains retryable without restoring access. Preserve source data and retain usable snapshots after source deletion.
- Save into any accessible folder, retry failures and repeated clicks, and exercise save/close races without losing messages, duplicating sessions or deleting attachments. Reopen the complete saved conversation after restart.

These are planned checks. No feature or desktop acceptance validation has been performed for this proposal.
