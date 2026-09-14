# DSH compatibility

Studio 0.5.0 and Artifact Services 0.2.0 target DSH 0.1.5-rc.1. Use the package manifests and dependency locks to select a consistent host; retained compatibility code does not imply support for every other DSH version.

## Host interfaces

| Area | Integration |
| --- | --- |
| Sidebar | Register a Start entry and an independent tab. The host owns collapse, fullscreen and tab restoration. |
| Files | Use the official `present` tool for final conversation outputs. Office and media viewers reuse Artifact Services. |
| Sessions | Read `snapshotEvents`, request headers and `session/event` boundaries; settle artifacts on `turn/end`. |
| Persistence | Use public persistence handles and preserve saved artifact identities. |
| Theme | Inherit host theme tokens for interactive controls. Exported documents keep their authored colors. |

Ordinary produced-file detection and the Studio artifact list serve different purposes. A tool should present verified final files explicitly; intermediate revisions are retained without being declared final outputs.

Upgrade and saved-data behavior are described in [Migration](MIGRATION.md). For isolated host and browser checks, see [Development](DEVELOPMENT.md).
