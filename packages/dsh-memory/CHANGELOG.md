# Changelog

## 0.2.2 — Unreleased

- 兼容 DSH 0.2.2-rc.2；将已验证的 0.2.2 预发布 API 系列纳入有界兼容范围，保留原有受支持的宿主。 验证新版 Session 批量追加事件，保持用户消息归属与记忆授权边界。
- Support DSH 0.2.2-rc.2 and the qualified 0.2.2 prerelease API family while retaining previously supported hosts. Verify batched Session append events preserve user attribution and memory authorization boundaries.

## 0.2.1 — Unreleased

- 兼容声明接纳已验证的 DSH 0.2.2-rc.1 与 Cordis 4.1；保留原有功能、配置及受支持的旧宿主范围。
- Accept qualified DSH 0.2.2-rc.1 and Cordis 4.1 peers, retaining existing behavior, configuration and supported older hosts.

## 0.2.0 — 2026-10-19

- Support standalone DSH 0.2.1-rc.2 and compatible 0.2.x stable Hosts through configForms.
- Align the bundle entry `memories` with its existing settings namespace so automatic legacy settings import and the settings page resolve the same entry. Storage domains, SQLite filenames and export format remain unchanged.
- Include current scoped history queries and locale integration; keep memory controls, pagination, corrections, retention and undo.

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
