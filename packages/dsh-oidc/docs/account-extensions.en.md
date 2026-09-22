# Institution account extensions

[简体中文](account-extensions.md) | **English**

Public OIDC owns identity, token authorization, model/default selection and sign-out. Quota HTTP, normalization and presentation remain optional institution extensions. resources(profileID) returns only model metadata. The current client does not provision or migrate model API keys; deploy matching client and Host descriptors.

## Host transport

An institution plugin depends on `oidcAccounts` and MUST first check its explicitly configured `profileIDs` allowlist. Installing an institution edition does not authorize quota requests for every organization the user adds.

```js
const response = await ctx.oidcAccounts.modelResourceFetch(profileID, '/quota', { signal })
```

This Host-only method has no Remote decorator and never exposes credentials. It uses the validated gateway API base and current Access Token; an authenticated auth profile is required. Only GET is supported. Paths consist of slash-separated letters, digits, underscores or hyphens; absolute URLs, query/hash, escaped or dot paths and extra options are rejected. Redirects are denied, timeout is 20 seconds, and the buffered response limit is 1 MiB. HTTP failures return Response; the extension defines safe user-facing states. Do not display raw request/response secrets.

Logout or reauthorization during response reading invalidates the result. The extension MUST also subscribe to `oidc/accounts-changed` and `credentials/reference-updated`, invalidate its generation, and check that generation after async operations. Abort requests on disposal. The public package does not cache extension data.

For OAuth Access Token services, use `authorizedFetch(profileID, endpoint, init, authorization?)`. Requests check expiry first and refresh up to 30 minutes early, capped at half the token's advertised lifetime: a ten-minute token refreshes with five minutes remaining. This avoids repeatedly refreshing newly issued short-lived tokens. The refresh timestamp is stored with Host credentials and survives restarts. Older sessions with only an expiry use the default margin until their first refresh adds the timestamp, without requiring sign-in. In `auth` mode, GET/HEAD also refresh and retry at most once after a 401.

Trusted Host services may pass `{ retryUnauthorized: true }` as the fourth argument for safely repeatable POST requests such as activity heartbeats. The body must be a buffered string or absent, never a stream. This option stays out of HTTP requests and client RPC, and does not broaden the allowed origins or paths. Model generation does not opt in and is never automatically replayed. Normal token rotation or natural expiry within the same authorization does not make the client cancel an active stream; the next request checks authorization again. The refresh margin is not a maximum generation duration or a substitute for correct server handling of long streams. See [the public protocol](public-resource-protocol.en.md). Neither transport schedules business requests itself.

Completed sign-in and sign-out emit `oidc/accounts-changed` with `authorizationChanged: true`, even when both sessions have state `connected`. Extensions must invalidate previous authorization failures and in-flight results instead of deduplicating by state name. Ordinary status polling still notifies only when the state changes.

## Client account menu

The public sidebar account declares the official `oidc.account.menu.details` child slot, `kind: single`, `scope: root`. Use `slots.inject()` before registering the occupant. Public UI continues to own identity, login, model connection and sign-out.

| Owner prop | Meaning |
| --- | --- |
| `profile`, `status` | Trusted configuration and non-secret current state; read-only |
| `busy` | Public account operation in progress; disable competing operations |
| `run(operation)` | Shared busy/error handling for an async user action |
| `refreshAccount()` | Reconcile identity/model connection without changing the selected model |
| `defaultContent` | Public Refresh account action; return it for inapplicable profiles |

```js
ctx.slots.inject('oidc.account.menu.details', () =>
  ctx.slots.register({ name: 'oidc.account.menu.details', priority: -100 }, Details))
```

The extension owns its own RPC/schema. Check explicit profile ID, provider configuration and `status.credentialReady` before reading; otherwise return `defaultContent` without querying quota. Discard late results after account change, sign-out or unmount. Focusable actions use `role="menuitem"` to share arrow/Escape/outside-focus behavior. Refresh must not replace a personal model selected later by the user.

An ECNU extension may display model allowance, reset dates, resource packs, details and refresh. Missing quantities are unknown; without a total, do not invent percentages. Its `/quota` wire is an institution contract outside the public resource protocol.
