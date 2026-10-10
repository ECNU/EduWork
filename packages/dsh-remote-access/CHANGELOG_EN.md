# Changelog

[简体中文](CHANGELOG.md) | **English**

Notable changes to this package. The project uses semantic versioning; for pre-1.0
compatibility, see the version section of the [protocol document](docs/protocol.md).

## 0.1.0-dev — unreleased

This package is **not published to npm and not yet assembled into the product runtime**.
What follows records what it currently contains and where it stands. It is not release
notes to be copied anywhere; release notes are written once a maintainer confirms them.

**Implemented**

- Device registry, one-time pairing invitations, device credentials, live-connection
  management. The logic modules perform no I/O and take the current time from the caller,
  which is what lets the pairing and revocation semantics be tested directly.
- Gated relay (`./listener`): admission, pairing entry and waiting page, per-device
  revocation, and admission and severing of the live channel. It is the only module in the
  package holding a file or a socket; storage location, listening port and topology are the
  deployment's to decide.
- Device records and credentials kept in one place, so that a single revocation cannot
  leave the two disagreeing.

**Implemented but unwired**

- The operation fence (`./gate`). Its decision table is complete and tested, and it has
  **no caller**, so in this stage it is not a security boundary. The reason is in the
  README's known trade-offs: to get the phone through the host's own door, the relay has to
  hand it the host's launch credential, so the phone holds a complete host browser session.
  Another HTTP relay in front of that cannot take back authority the host has already
  granted. The real gate can only be enforced by the host's own authorization layer.

**Planned, not in this package**

- A host-side enforcement fence, assembly into the product runtime, a standalone Web
  client, end-to-end encryption including the relayed case.

**Known limitations**

- There are two places in the package a device can be recorded (`DeviceRegistry` and
  `DeviceStore`) and they cannot see each other. Merging them belongs to the step that
  assembles the package into the product; see the README's known trade-offs.
- Device records carry no separate revocation timestamp. `lastSeenAt` serves both "last
  seen active" and "was revoked".
