# Security model

[简体中文](security-model.md) | **English**

## Protection goals

1. App passwords do not enter ordinary settings, browser readback, tool arguments, session results, or logs.
2. Reading does not change server state.
3. Prompt injection in mail cannot become a system instruction, user authorization, or secret request.
4. The Agent sends only when sending is enabled and the current DSH permission preset permits it.
5. Attachments cannot escape the session workspace through relative paths, symlinks, or junctions, or consume unbounded memory/disk.
6. Ambiguous SMTP results never trigger an automatic retry and duplicate send.

## Trust boundaries

- **Trusted within documented responsibility:** DSH Host, selected Credential Provider, user-saved server configuration, user-selected permission preset, and ordinary-mode actions in the Approval UI.
- **Untrusted:** message bodies, subjects, addresses, attachment names and content; model-generated tool arguments; remote IMAP/SMTP error text.
- **Conditionally trusted:** current session workspace files. They may become user-authorized outbound attachments but remain subject to path, type, count, and aggregate-size checks.

## Prompt injection

The canonical body field is `untrustedText`. Rendering adds a fixed warning and prefixes every serialized JSON line. The Host also injects a stable rule that mail cannot authorize sending, request secrets, or modify system policy.

Warnings are defense in depth. The actual mutation boundary is enforced by the separate `sendEnabled` capability, argument validation, workspace fencing, and DSH's native `tools/pre-execute` permission path. Even if the model mishandles text, the mail body cannot bypass those mechanisms.

## Send approval

`mail_send` enters DSH permission handling before credentials, attachments, or SMTP access:

- ordinary presets return `ask`; rejection, cancellation, or unavailable Approval fails closed;
- Full Access continues without creating a prompt that its `approval: never` policy would reject;
- a missing Agent-backed session is denied;
- the Mail assistant sending capability must be independently enabled in every mode.

Full Access therefore has the same meaning as for other DSH write tools: the user chose prompt-free execution for the active session. With sending enabled, the Agent may send without per-message dialogs. Use an ordinary preset when every message requires review, and never infer background-task authorization from interactive Full Access.

## Transport security

- implicit TLS or STARTTLS only;
- certificate validation fixed on;
- no plaintext IMAP/SMTP;
- protocol logging disabled;
- bounded connection and socket timeouts;
- arbitrary remote errors never returned verbatim to the model.

## Remaining risk

- An app password may carry broader server permissions than the local read/send switches. Those switches are plugin policy and do not reduce the credential's authority in other clients.
- Full Access removes per-message prompts after sending is enabled.
- SMTP has no generic idempotency. A DATA disconnect may occur after acceptance; `unknown` still requires human inspection.
- MIME is complex. The plugin checks server-reported message size before parsing, but a malicious or broken server may report inconsistent metadata.
- Local downloads recheck logical and real paths but still rely on the Host filesystem. A compromised same-user process may race with filesystem operations or access files available to that OS user; this plugin is not OS isolation.

## Reporting

Never publish app passwords, real messages, or personal logs. Follow the private process in [Security policy](../SECURITY.en.md).
