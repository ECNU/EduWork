# Desktop profile location

[简体中文](README.md) | **English**

Status: implemented. macOS and Windows configuration and all user data live under `.config/<distribution>/` in the user home; the public edition uses `.config/eduwork/`. Native profiles use the version-independent `dsh/profiles/desktop-native` directory. First launch copies and verifies old data, retaining the original; an existing new tree takes precedence without merging.

See the [directory design](../../dev/desktop-user-directory.md) for paths, migration and rollback, and the [configuration guide](../../CONFIGURATION_EN.md) for the effective file. Credentials, restart persistence and update installation still require native acceptance on both platforms.
