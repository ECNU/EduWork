# DSH 0.2.2 integration

[中文](CORE-022.md)

The build recipe selects DSH `0.2.2-rc.1`, upstream commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`. `config/desktop-build.json` selects the [candidate lock](../third_party/dsh/candidate-v0.2.2-rc.1/LOCK.json), pinning npm Runtime, published plugins and Host/Electron source inputs separately. Product and core versions are independent; selecting a recipe does not publish installers or update feeds.

## Interface and features

Use the official mobile layout, text quotes, failed-send draft retention, message menus, history copying, plugin details and updates, file preview and unified automation interface. Official plugin management controls experimental features; existing distribution policies for identity, telemetry and feedback still apply. Browser integration retains its existing behavior.

Upstream Web Fetch now uses the process proxy policy and permits private network addresses. Deployments that restrict model network access should enforce outbound network policy; this integration does not add a second fetch implementation.

[Annotations](../packages/dsh-annotation/README_EN.md) share the native selection menu with Quote text and optional side chat. DSH still owns the composer, native quotes, sending and history restoration. Editing annotations reads semantic coordinates from the read-only `draftSnapshot` getter. Upstream's public SessionInput type does not declare this getter yet: review it on upgrades and reject edits without modifying the draft if it is absent or coordinates disagree.

Settings navigation icons use the official `settings.section.icon` slot and its unload fallback; the current recipe no longer invokes the settings-navigation Runtime patch. Desktop file saving, native file-drag preparation and startup diagnostic reports use official desktop modules. Host shutdown adopts upstream behavior without the previous forced-exit adaptation. Software-update download, verification, delta and installation mechanisms retain their existing implementation.

## Plugin compatibility

- Cordis moves to 4.1. Independent npm packages explicitly accept rc.1 while their development locks continue testing the previously supported Host.
- Tool execution now uses batch executors. Nested Office calls from Studio/media use shared artifact services' `executeGovernedTool` and the official ToolExecutionPipeline, preserving policy, cancellation, step admission and parent/root identities. Older hosts retain their single-call path.
- Artifact collection reads official Agent turn boundaries instead of removed Session Projection state access. Literature and side-chat Runtime checks use the official tool pipeline.
- Automation tasks are Host-wide. Quit inspection still reads the persisted catalog, including sessions without loaded Agents, so active scheduled tasks are not overlooked.
- External-agent Codex/ACP providers must match the Host version, avoiding a second, older core inside rc.1. Development and product locks are qualified separately.

Publish independent plugins to npm, verify versions, source commits, tarball SHA-256 and integrity, then update exact product locks. Do not overwrite published plugins with local sources. See [package maintenance](PACKAGES_EN.md).

## Retained adaptations

Search consistency, spurious client reloads from ctime changes, user-message annotation decoration, file-reference cards and Creator availability still need adaptations, checked against reviewed source hashes or unique anchors. File-reference presentation modifies references only, leaving native quotes intact. Creator respects product controls rather than enabling a disabled capability automatically.

Existing settings, accounts, sessions and user choices continue migrating. Defaults for new features must not overwrite saved choices. Previous combinations are recorded in [0.2.1 integration](CORE-021_EN.md).

## Verification boundaries

See the [build guide](BUILD.md) for entry points. Source integration CI checks locks, Host, Windows/macOS Electron bridges and the assembled product. Plugin checks use synthetic identity, search and model inputs. Native dragging into another application, real institution login, model services and installer upgrades require separate acceptance; registration and synthetic smoke checks do not replace it.
