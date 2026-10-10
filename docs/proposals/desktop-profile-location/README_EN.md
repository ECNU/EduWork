# Desktop profile location

[简体中文](README.md) | **English**

## Scope

This PR changes the native DSH profile name from `desktop-017` to `desktop-native`, independent of the Runtime version. Only `DSH_HOME/profiles/desktop-017` → `DSH_HOME/profiles/desktop-native` changes. The legacy Runtime keeps `profiles/desktop`.

DSH_HOME, eduwork.jsonc, examples, sessions, attachments, browser data and update state retain their existing locations. Configuration visibility, bundled resources and existing Skills and plugin import behavior remain unchanged.

## Implemented migration rules

`prepareProductProfile(...)` selects `desktop-native` for the native Runtime and `desktop` for the legacy Runtime.

- If only the old directory exists, validate ownership and path boundaries, require an ordinary directory, and rename the whole directory within its parent. Preferences, dependencies, plugin activation and write journals move together.
- If the new directory exists, use it without migrating or merging the old directory, even if the new directory is empty.
- If neither exists, initialize the new profile using existing behavior.
- Reject a migration source that is a symlink, a non-directory or outside the owned home. Filesystem rename errors also fail startup.

Desktop startup acquires its single-instance lock before profile preparation. CLI calls to the preparation function do not share that lock. Existing preparation updates generated configuration and completes pending transactions after the rename; migration does not rewrite paths inside user files.

## Risks and acceptance

| Risk | Impact and boundary | Required acceptance |
| --- | --- | --- |
| Both directories exist | The new directory wins even when empty; old preferences are neither restored nor merged. | Cover existing and empty new directories and divergent preferences; identify the active directory during troubleshooting. |
| Custom absolute paths | Absolute paths, file URLs or symlinks pointing into the old profile may break. Preserved file contents do not guarantee custom dependency resolution. | Validate local plugins and links; users may need to repair old path references. |
| Rename failure and concurrency | Windows file locks or permissions may prevent startup. The desktop lock does not coordinate CLI writes to the same home. | Validate upgrade and repeated startup on macOS and Windows; avoid concurrent CLI operations during migration. |
| Startup fails after rename | A same-parent rename avoids partial per-file copying, but later startup failure does not restore the old name. | Validate restart and pending configuration transaction recovery. |

Assessment: forward migration with standard configuration has low risk; custom absolute paths have compatibility risk. Keep the PR in Draft until native upgrade and restart acceptance completes on both platforms. Those checks are not claimed as completed. Older-version downgrade is outside this PR’s scope.
