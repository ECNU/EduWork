# Component inventory interface

[简体中文](README.md)

Adds a read-only Components and versions view under the official plugin settings. It reports the product, DSH Core, Node.js, pnpm and other detected components, including readiness and source information.

The official plugin list and configuration remain responsible for installed plugin management. Web compositions omit desktop operations that require native dialogs or a process restart; the UI does not simulate an unavailable desktop bridge.

Build with `build-client.ps1`, supplying `-Upstream`, `-DshLockPath` and `-Output` for the locked DSH source.
