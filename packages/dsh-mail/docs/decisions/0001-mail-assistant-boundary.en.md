# ADR 0001: Keep the plugin an assistant for reading and explicit sending

[简体中文](0001-mail-assistant-boundary.md) | **English**

## Status

Accepted, 2026-09-01.

## Context

A DSH Agent benefits from user-controlled reading and sending, but a standard IMAP/SMTP app password usually carries broader mailbox authority than one task. Adding delete, move, archive, flags, background synchronization, and auto-reply would turn the plugin into a broad but inferior mail client while increasing accidental mutation, prompt-injection, and persistent-authorization risk.

Provider-specific OAuth2 APIs use authentication, scope, and audit models different from generic IMAP/SMTP. The current goal is interoperability with institutional, self-hosted, and app-password-capable services rather than a universal mail client.

## Decision

One plugin owns a settings surface and five bounded tools: folder discovery, paginated metadata search, read-only message retrieval, workspace attachment download, and plain-text sending. Reading and sending are enabled independently; IMAP is fixed read-only; SMTP uses DSH permission presets; mail is always untrusted; credentials only enter a DSH Credential Provider.

Delete, move, archive, flag mutation, contacts, rules, polling, auto-reply, HTML composition, and scheduled sending are outside v0.1. OAuth2 and multiple accounts require explicit architectures and cannot place tokens or multiple passwords in ordinary settings.

## Consequences

- The plugin can be open-sourced and composed by Web or desktop DSH without depending on a particular product composition.
- Users keep a professional mail client for mailbox-state management; the Agent focuses on retrieval, understanding, and authorized sending.
- Full Access matches other DSH write tools and skips per-call approval, while the independent sending capability remains mandatory.
- Any future background or mutation boundary requires another ADR, threat model, and migration plan.
