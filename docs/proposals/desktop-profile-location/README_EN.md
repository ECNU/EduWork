# Desktop profile location

[简体中文](README.md) | **English**

The native DSH profile changes from `DSH_HOME/profiles/desktop-017` to `DSH_HOME/profiles/desktop`, independent of the Runtime version. Old directories are neither migrated nor deleted automatically. Users can ask AI to migrate preferences and plugins after exiting the client and backing up. An existing legacy Runtime directory with the same name must first be backed up and moved aside to avoid reusing its App dependency link.

Only the internal profile name changes; other configuration and data paths, bundled resources and plugin import behavior remain unchanged.
