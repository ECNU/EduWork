# Desktop profile location

[简体中文](README.md) | **English**

## Scope

This PR changes the native DSH profile name from `desktop-017` to `desktop`, independent of the Runtime version. Native and legacy Runtime startup both select `DSH_HOME/profiles/desktop`.

DSH_HOME, eduwork.jsonc, examples, sessions, attachments, browser data and update state retain their existing locations. Configuration visibility, bundled resources and existing Skills and plugin import behavior remain unchanged.

## Implemented behavior

`prepareProductProfile(...)` directly uses desktop, initializing it when absent. It does not inspect, migrate, merge or delete desktop-017, or create desktop-legacy. The retired path is no longer a native profile loading location.

An existing usable native desktop profile remains active. An old Runtime profile has a node_modules link into the App; existing native profile safety checks reject this link. Users must back up and move the conflicting directory before startup; nothing is automatically overwritten.

## User migration and risks

This is a breaking profile-path change. Preferences, user-installed plugins and activation state from the retired native profile are not automatically carried over; original files remain. Users who need these settings can ask AI to assist after fully exiting clients and backing up. See [CHANGELOG](../../../CHANGELOG.md).

Migration must distinguish the retired native desktop-017 profile from an old Runtime desktop profile; do not merge dependency directories across Runtimes. Custom absolute paths or file links into the retired profile may need repair.

No directory migration code remains, eliminating rename failures and concurrency risks introduced by migration. An existing legacy Runtime directory can still prevent startup, and reinstalling the App does not guarantee removal of user configuration. Keep the PR in Draft pending actual macOS and Windows initialization and existing-profile conflict acceptance.
