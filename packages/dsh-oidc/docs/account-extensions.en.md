# Institution account extensions

[简体中文](account-extensions.md) | **English**

As of `0.2.0-dev.20260910.6`, public OIDC owns identity, managed model keys, models/default selection and sign-out. Quota HTTP, normalization and presentation are external, and public OIDC sends no heartbeat. `resources(profileID)` returns only `{profileID, modelSource, models, issues}`. Extracting quota alone does not require a new login. The dev.7 credential rename migrates only verified ownership and an identical deployment binding; unproven ownership retains identity but requires model-resource reconnection. Deploy matching client and Host type descriptors.

## Host transport

An institution plugin depends on `oidcAccounts` and MUST first check its explicitly configured `profileIDs` allowlist. Installing an institution edition does not authorize quota requests for every organization the user adds.

```js
const response = await ctx.oidcAccounts.modelResourceFetch(profileID, '/quota', { signal })
```

This Host-only method has no Remote decorator and never exposes credentials. It uses the configured `profile.provider.baseURL`, active identity and current managed model key; `provider` and `keyBinding` are required. Only GET is supported. Paths consist of slash-separated letters, digits, underscores or hyphens; absolute URLs, query/hash, escaped or dot paths and extra options are rejected. Redirects are denied, timeout is 20 seconds, and the buffered response limit is 1 MiB. HTTP failures return Response; the extension defines safe user-facing states. Do not display raw request/response secrets.

Logout or key replacement during response reading invalidates the result. The extension MUST also subscribe to `oidc/accounts-changed` and `credentials/reference-updated`, invalidate its generation, and check that generation after async operations. Abort requests on disposal. The public package does not cache extension data.

For identity-token services, use the separate `authorizedFetch(profileID, endpoint, init)` method with approved origins, token refresh and one 401 retry. See [the public protocol](public-resource-protocol.en.md). Neither transport schedules business requests itself.

## Client account menu

The public sidebar account declares the official `oidc.account.menu.details` child slot, `kind: single`, `scope: root`. Use `slots.inject()` before registering the occupant. Public UI continues to own identity, login, model credential provisioning and sign-out.

| Owner prop | Meaning |
| --- | --- |
| `profile`, `status` | Trusted configuration and non-secret current state; read-only |
| `busy` | Public account operation in progress; disable competing operations |
| `run(operation)` | Shared busy/error handling for an async user action |
| `refreshAccount()` | Reconcile identity/model connection without automatic provisioning |
| `defaultContent` | Public Refresh account action; return it for inapplicable profiles |

```js
ctx.slots.inject('oidc.account.menu.details', () =>
  ctx.slots.register({ name: 'oidc.account.menu.details', priority: -100 }, Details))
```

The extension owns its own RPC/schema. Check explicit profile ID, provider configuration and `status.credentialReady` before reading; otherwise return `defaultContent` without querying quota. Discard late results after account change, sign-out or unmount. Focusable actions use `role="menuitem"` to share arrow/Escape/outside-focus behavior. Refresh must not replace a personal model selected later by the user.

An ECNU extension may display model allowance, reset dates, resource packs, details and refresh. Missing quantities are unknown; without a total, do not invent percentages. Its `/quota` wire is an institution contract outside the public resource protocol.
