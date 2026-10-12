# Desktop profile location proposal

[简体中文](README.md) | **English**

Status: incomplete. This PR identified the profile naming and location issue; a separate PR will design and implement the change. This PR leaves profile paths and user data unchanged.

The Electron launcher sets `DSH_HOME` to the distribution's data directory. The native DSH profile is fixed at `DSH_HOME/profiles/desktop-017`. On macOS, application data is under the user's Application Support directory; the portable Windows build stores it under the installation's `data` directory.

Follow-up work must define the boundary between the profile and user-editable configuration, verify DSH's `DSH_HOME` path requirements, and plan migration and rollback for existing installations. Renaming the directory alone would hide existing settings and state.
