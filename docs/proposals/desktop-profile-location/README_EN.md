# Desktop profile location

[简体中文](README.md) | **English**

The native DSH profile's internal name changes from `desktop-017` to `desktop-native`, independent of the Runtime version. If only the old directory exists, startup renames it after acquiring the desktop single-instance lock, preserving preferences, dependencies and update journals. If both exist, the new directory wins without merging. The legacy Runtime's `profiles/desktop` remains separate.

Only the internal profile name changes. DSH_HOME, editable configuration, sessions, attachments, browser data and update state retain their existing locations and import behavior. See the [design](../../dev/native-profile-name.md).
