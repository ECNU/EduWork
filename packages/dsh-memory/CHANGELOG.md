# Changelog

## 0.1.1

- Require the exact DSH 0.1.5-rc.1 Host baseline; upgrade older Hosts before installing.
- Fix Session event reads with snapshotEvents(), preserving explicit-user authorization and external-tool provenance; unreadable events fail closed.
- Verify Session V3 history retrieval, independent prompt integration and synthetic legacy SQLite compatibility.
- Clarify clean-install verification, configuration, local-storage privacy and migration boundaries.
- Preserve domain v1, export v2, capacity/protection rules and user controls.

## 0.1.0

- First standalone public package as `@eduwork/dsh-memory`.
- DSH 0.1.2-rc.1 public-service integration, self-contained npm build and installable bundle.
- Preserves local semantic memory, official prior-chat retrieval, ten-record manager pagination, correction/undo, user retention, deletion and suppression.
- Preserves domain v1, settings/service identities and legacy SQLite paths; includes real legacy-write/new-reader restart regression.
- Includes Windows/Linux CI, packed Host/Web checks and opt-in Trusted Publishing release workflow.
