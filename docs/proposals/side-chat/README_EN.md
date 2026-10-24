# Side chat proposal

[简体中文](README.md) | **English**

Status: **An isolated first-stage experiment exists; default products do not include it. Promotion remains planned.** The experiment and the intended complete design are distinguished below; this is not a delivered release.

## Current experiment

Following [Codex `/side`](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/tui/src/app/side.rs), the first stage provides temporary side chats with **no promotion action**. User messages and completed assistant answers can start one. **Its transcript starts empty, with event sequence 0; source messages are not copied into it.** A separate in-memory reference context through the selected message is included only in model requests. Only new side requests are active instructions. Opening does not call a model.

One side chat is allowed per window. Reopening the same boundary reuses it; another boundary requires closing the existing chat. The last model request before the cutoff determines model selection, falling back to the deployment default. The source Agent preset is mounted afresh, with current permissions. Subagents, schedules, long-lived background work, nested side forks and dedicated worktrees are prohibited.

Messages stay in memory, outside persistence, lists, search and automatic history-memory indexes. Temporary drafts, view preferences and sidebar tabs are not persisted in the browser. Collapse, main-session navigation, artifact preview and window hiding retain state; explicit close, refresh and actual exit end it. Abrupt disconnections expire through a 45-second lease plus cleanup polling. Failed cleanup remains non-renewable and retries. Explicit file changes and external operations are not rolled back.

Pinned DSH `0.2.1-rc.2` provides exact forks, turn closure, Agent scopes, embedded chat and sidebar tabs. **The published npm Runtime lacks the complete temporary-lifetime contract.** The experiment adds `ephemeral` factory options and metadata, handling them in persistence, queries, discovery events and client storage. Hash-guarded derivatives of npm compiled outputs retain corresponding source changes and file receipts. They only write new experimental directories, identify themselves as `experimental-side-chat`, and cannot serve as default npm caches or product locks. Formal integration requires an agreed upstream contract and compatible published version.

Complete experimental acceptance uses the historical rc.2 baseline; default mainline products now use rc.3. Its official Session and AgentLoop compiled outputs were checked and are identical to rc.2, still lacking temporary lifetime and separate reference-context interfaces. This is not whole-product rc.3 certification. Hidden references retain the native history projection at the cutoff; new side records use ordinary compaction. Independent budgeting/recompaction of very long references remains a formal-integration decision; unlimited history is not promised.

See the [experimental package](../../../packages/dsh-side-chat/README_EN.md) for implementation and commands. Automation covers real Runtime model loops, cutoff, persistence/search isolation, ordinary persistence, independent cancellation, background-tool restrictions, open/close races, leases and cleanup retries. Browser acceptance uses an isolated Host and deterministic model. This does not replace real-provider, multimodal, Office, OIDC or audiovisual acceptance. Complex tool/attachment history, missing attachments, source deletion, narrow windows and multiple windows still need dedicated acceptance. Experiments disable updates, do not publish npm packages, and do not change default component locks.

## Complete design intent (planned)

Users can choose “Open side chat” on any user or assistant message in an existing conversation and ask follow-up questions in a right panel while keeping their place in the original conversation. For example, they can discuss a grading rubric beside a course-planning conversation without interrupting its subsequent planning work.

A side chat has a new session ID, its own input, generation state and cancellation controls. Its header shows a temporary-chat label, a source-message link, Close and “Save as conversation.” It is an independent conversation controlled directly by the user, rather than a delegated subagent. Results are not automatically sent back to the original conversation.

## Differences from ordinary conversations

| Aspect | Side chat before saving | Ordinary conversation, including a saved side chat |
| --- | --- | --- |
| Starting context | Empty transcript; a separate reference context through the selected message accompanies model requests | Empty when newly created, or retained context after saving |
| Display | Temporary panel beside the source | Main conversation area |
| Organization and discovery | Excluded from conversation lists, folders, search, recents and automatic history-memory indexing | Managed under existing conversation rules |
| Lifetime | Deleted on explicit close; not restored after restart | Retained when its view closes; requires explicit deletion |
| Models and tools | Reuses ordinary capabilities, permission rules and global concurrency limits | Existing execution rules |
| Saving | User explicitly chooses a folder to retain it | Persisted normally |

## Complete design boundaries (planned, including promotion)

1. **History cutoff.** Carry the currently visible branch through the selected message as reference context, excluding later messages. Subsequent additions, edits and regenerations in either conversation do not affect the other. The side transcript starts at 0 and contains only its new conversation. Any future history viewer must remain a separate read-only reference view. Selecting a user message does not replay its request; the user sends a new follow-up.
2. **Message boundaries.** Provide the action on every user message and completed assistant message, excluding internal tool events as separate entry points. A streaming assistant message must complete or stop first to avoid copying partial output or incomplete tool calls. Historical tool calls and results must form valid context and must never be executed again. Long histories follow ordinary context-compaction rules with a visible indication when compaction is used; sending every original word on every request is not guaranteed.
3. **Independent execution.** Start with the source conversation’s current model and Agent preset, allowing later independent changes. Main and side chats can generate concurrently and stop independently. Evaluate permissions for the new session without copying one-time approvals, active tasks, pending approval requests or subagents. Preserve usable attachment content and references, and explicitly report unavailable content; copying a display card alone does not count as carrying its content.
4. **Closing and navigation.** Initially allow one temporary side chat per client window. Navigating away from the source or opening an artifact preview hides the panel while retaining temporary state; returning restores it. Collapsing is distinct from closing. Opening another side chat requires an explicit choice to save the existing one or close and discard it. Closing the panel, its owning window or the client ends the temporary session; refresh and abnormal restart do not restore it. Narrow windows may use an overlay with the same lifetime.
5. **Disappear on close.** Immediately revoke access to the temporary session, cancel its generation, queued requests and owned background tasks, then clean up its messages, draft and exclusive caches. A temporary namespace in existing session storage is acceptable, but it must remain outside ordinary indexes. Reclaim crash leftovers on next startup. Delete only exclusively owned temporary data, preserving source attachments. External effects such as sent mail or modified work files are not undone, and temporary chat does not promise that providers retain no requests.
6. **Explicit saving.** “Save as conversation” allows title editing and selection of any accessible conversation folder, including unfiled. Save inherited history, new messages and required attachments, retain the session ID, and open it as an ordinary conversation. Closing its view thereafter does not delete it. Failure or cancellation leaves it temporary and retryable. Finish or stop generation before saving; prevent concurrent closing during commit, and make repeated saves idempotent.
7. **Folder versus working directory.** Folder selection changes conversation organization without implicitly moving files or changing tool working directories. If existing folders bind to project working directories, explain this and reuse project migration rules, verifying attachments and paths before declaring success. Temporary chats initially use the source working directory, so both conversations may modify the same files; independent conversations do not imply filesystem isolation.
8. **Source and memory.** Source metadata supports navigation rather than being the sole means of reading inherited history. Snapshots and saved conversations remain usable after source edits or deletion. Temporary chats do not automatically enter long-term memory or become searchable by other conversations. Explicit user requests to write external files, knowledge bases or memory follow existing permissions and are not undone on close.

The initial version excludes multiple side panels, branching within a side chat, automatic merge-back, cross-device temporary-chat synchronization and crash recovery. Save the conversation for long-term retention.

## Further promotion assessment

**Promotion still requires design across layers.** The first stage verifies precise cutoffs, two chat panels and temporary-storage isolation in the experimental Runtime. Atomic promotion, independent attachment retention and arbitrary folder classification remain unimplemented.

Reuse ordinary message projections, input, model execution, tool permissions and attachment services, adding an explicit temporary lifecycle. The UI owns only the action and panel. The temporary marker must reach backend session queries, search, memory scans, export and notification routing; hiding list entries in the frontend is insufficient. Change lifecycle state only after permanent storage and attachment references commit successfully. Cleanup and saving must share state constraints to prevent deletion races or duplicate saves.

Formal integration needs agreed DSH contracts and published versions, plus further checks of complex tool/attachment history and folder/cwd relationships. Preserve npm and component locks; experimental derivatives cannot masquerade as official packages. Reuse the existing conversation engine and layout facilities.

## Planned acceptance checks

- Branch from earlier user, assistant and tool-bearing messages; verify cutoff, attachments and context. Later source changes must not leak in, and historical tools must not replay.
- Verify concurrent generation, independent cancellation, navigation, artifact preview, collapse and explicit close. Search, memory and restart must not recover closed temporary chats.
- Stop owned tasks on close. Failed cleanup remains retryable without restoring access. Preserve source data and retain usable snapshots after source deletion.
- Save into any accessible folder, retry failures and repeated clicks, and exercise save/close races without losing messages, duplicating sessions or deleting attachments. Reopen the complete saved conversation after restart.

These checks concern the complete design and cannot be replaced by first-stage tests. Decisions remain on promotion identity, atomic save/close, and whether arbitrary folders classify conversations separately or change tool working directories.
