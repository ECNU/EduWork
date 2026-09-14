# Enterprise Profile specification (`dsh-oidc/v1alpha1`)

> Candidate extension: omit both keyBinding/provider for identity-only OIDC; brand is optional. Resource mode accepts keyBinding.type=eduwork-resources-v1 (default worker-user-center-v1). provider.modelSource=discovery may omit models; normal profile mode requires models. See [Public resource protocol](public-resource-protocol.en.md).

[简体中文](enterprise-profile.md) | **English**

## Status and conformance

This document specifies the data contract consumed by `dsh-oidc` `0.2.x`. The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are interpreted as described by RFC 2119 and RFC 8174.

The canonical machine-readable schema is [`schema/enterprise-profile.v1alpha1.schema.json`](../schema/enterprise-profile.v1alpha1.schema.json). Runtime validation is intentionally stricter in several security-sensitive URL cases. A conforming profile MUST pass both JSON Schema validation and `normalizeEnterpriseProfile()`.

## Trust model

Profiles are trusted deployment configuration, not user input. Nevertheless, the parser is fail-closed:

- unknown keys are rejected at the root and at every executable-relevant nested object;
- total serialized profile size is limited to 512 KiB;
- production URLs require HTTPS;
- development HTTP needs an explicit loopback allowance or exact development-origin allowlist;
- URL credentials, fragments, and endpoint-base query strings are rejected;
- only the built-in `openai-compatible` adapter can be selected;
- Key Binding accepts only its protocol base and an optional local DSH credential reference; network paths and fields remain fixed;
- logo data URLs accept PNG/WebP only, not SVG.

A remote administration system MAY distribute profile JSON only if the host authenticates the source, verifies integrity, and stages changes through review. Downloaded JSON does not become safe merely because it contains no JavaScript.

## Root object

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | yes | Exact string `dsh-oidc/v1alpha1`. |
| `id` | yes | Profile ID matching `^[a-z][a-z0-9-]{0,63}$`. |
| `displayName` | yes | Human-readable integration name. |
| `organization` | no | Organization label; defaults to `displayName`. |
| `nativeInstitutionID` | no | Identifier passed only to a native backend; defaults to `id`. |
| `allowInsecureDevelopment` | no | Enables loopback HTTP for local development. Network HTTP additionally requires `insecureDevelopmentOrigin`. |
| `insecureDevelopmentOrigin` | no | Exact non-TLS development origin. It is accepted only together with `allowInsecureDevelopment: true`, and every HTTP OIDC/key-binding/provider endpoint must use this exact origin. Never ship it in a production profile. |
| `brand` | no | Bounded presentational values. |
| `oidc` | yes | OIDC public-client facts. |
| `keyBinding` | resource mode | Key Binding base URL and optional local DSH credential reference. |
| `provider` | resource mode | One local OpenAI-compatible Provider route and model list. |

## Branding

Branding changes only approved presentation surfaces. It does not alter authentication or executable behavior.

| Field | Limit / behavior |
| --- | --- |
| `productName` | 80 characters; document/sidebar label. |
| `organizationName` | 120 characters. |
| `mark` | 1–4 characters used when no logo is supplied. |
| `logoURL` | HTTPS URL or base64 PNG/WebP, at most 128 KiB as text. Remote images use `referrerPolicy=no-referrer`. |
| `primaryColor` | Six-digit hex color. Only a bounded DSH token set is overridden. |
| `loginTitle` | 120 characters. |
| `loginDescription` | 500 characters. |
| `supportURL` | Absolute HTTPS URL opened with `noopener noreferrer`. |

Profiles MUST NOT include logos or names without permission from the rights holder. Operators concerned about remote-image tracking SHOULD package a base64 PNG/WebP or host the asset on a controlled origin with a restrictive CSP.

## OIDC object

```json
{
  "issuer": "https://id.example.edu/oidc",
  "clientId": "dsh-web-public-client",
  "scopes": ["openid", "profile", "offline_access"]
}
```

- `issuer` is an OIDC Issuer Identifier. Paths are supported; query and fragment are not. Exact string equality with Discovery metadata is required.
- `clientId` identifies a public client. No client secret belongs in a profile or this plugin.
- `scopes` MUST contain `openid` and `profile`, contain no whitespace within an item, and contain no duplicates.
- `offline_access` SHOULD be requested when the Provider issues refresh tokens and policy allows it.
- Key Binding authorization scopes are deployment-specific but SHOULD use the names in the reference example.

The Web redirect URI is fixed to `http://127.0.0.1:<DSH-port>/oauth/callback`. The host and path are not configurable; the port follows the DSH WebServer's actual listening port.

## Key Binding object

```json
{
  "baseURL": "https://ai.example.edu/api/worker/v1",
  "credentialRef": "EDUWORK_API_KEY"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `baseURL` | yes | Base URL of the `worker-user-center-v1` Key Binding interface group. |
| `credentialRef` | no | Local DSH Credential Provider name under which the bound model API key is stored. It must match `^[A-Za-z_][A-Za-z0-9_]*$` and is limited to 128 characters. |

The Provider ID sent on the wire is always `provider.id`. An omitted `credentialRef` now defaults to `EDUWORK_API_KEY`. Legacy automatic references derived from this Profile’s `id` or `provider.id` (uppercase, non-alphanumerics replaced with `_`, followed by `_API_KEY`) normalize to this common name. Other explicit references remain unchanged.

`credentialRef` names a local secret-store entry; it is not a key and is never sent over the network. Normal deployments use `EDUWORK_API_KEY`; explicit independent overrides such as `MY_TEST_MODEL_KEY` remain supported. With a shared reference, only a verified login whose bound credential fingerprint matches the current key may read it. Rebinding leaves other profiles disconnected from that key, and their logout cannot delete a key written by another login. Independently configured personal model credentials are unaffected.

An upgrade imports an old key only when issuer, client ID, management URL, runtime URL and Provider ID all match and only the automatic reference changed. It neither overwrites nor adopts an occupied target. Unproven ownership retains identity but requires reconnecting model resources. Pre-fingerprint sessions are accepted only with an identical complete binding and unambiguous reference ownership.

Endpoint paths, request/response fields, and Provider ID semantics are protocol facts and MUST NOT be customized by profiles. If a native host returns `runtimeCredentialRef`, it MUST equal the normalized profile value or the plugin fails closed.

## Provider object

The Provider object is data interpreted by a local audited adapter.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | DSH route ID, independent of the shared default credential reference. Must be unique across loaded profiles. |
| `displayName` | no | User-facing Provider name. |
| `adapter` | yes | Exact string `openai-compatible`. |
| `baseURL` | yes | HTTPS OpenAI-compatible API base. |
| `reasoning` | no | Default DSH/pi-ai reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; default `high`. |
| `defaultContextWindow` | no | Positive safe integer, default 262144. |
| `defaultMaxTokens` | no | Positive safe integer, default 32768. |
| `maxRequestImageBytes` | no | Accumulated native-image request budget. |
| `requestImagePixelBudget` | no | Image normalization pixel budget. |
| `requestImageMaxBytes` | no | Per-normalized-image byte budget. |
| `streamIdleTimeoutMs` | no | Positive idle timeout, default 300000. |
| `retryPolicy` | no | DSH provider-owned retry policy; default normal/2 retries. |
| `compat` | no | Bounded pi-ai OpenAI compatibility facts. |
| `modelSource` | no | `profile` (default) or `discovery`; discovery requests `/models` with the managed key. |
| `models` | profile mode | 1–128 unique entries; discovery may omit them, and configured entries supply reviewed capabilities. |

`retryPolicy.mode` is `normal` or `always`. `always` can retry indefinitely until success, cancellation, or disposal and SHOULD NOT be enabled without an explicit product decision. The policy is validated again by DSH.

`compat` accepts only the keys enumerated in the JSON Schema. Operators MUST describe provider facts accurately; a compatibility override can change request semantics, though it cannot execute code.

## Model entries

Each model has:

- required `id`;
- optional display `name`;
- `input` containing `text`, `image`, or both (default `text`);
- optional positive `contextWindow` and `maxTokens`;
- optional `reasoning` boolean;
- optional `reasoningEfforts` object, or `false`; object keys are limited to `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, and only `off` may have a null wire value;
- optional `defaultReasoningEffort`, which must name an effort declared by that model; when omitted, the historical provider-level `reasoning` preference falls back to the nearest supported effort, choosing the lower effort on a tie;
- optional bounded `compat` overrides.

Once `reasoningEfforts` is declared, every omitted effort is explicitly unsupported. Effort IDs and wire values remain distinct, so `xhigh` is never silently rewritten as `max`. For thinking without a user-selectable effort, set only `compat.supportsReasoningEffort` to `false`; for a model with no thinking capability, set `reasoning` or `reasoningEfforts` to `false`.

If a model supports thinking but not selectable reasoning effort, set:

```json
{
  "compat": { "supportsReasoningEffort": false }
}
```

The adapter preserves the profile's thinking behavior: historical user-selected efforts are ignored, the profile default is resolved against that model's supported levels, and only an internal enabling signal is passed to PiAi. `compat.supportsReasoningEffort: false` keeps `reasoning_effort` out of the HTTP request. This signal does not create selectable UI efforts; a profile default of `off` still disables models that support it. The request is not rejected merely because the provider lacks an effort parameter.

## Secret prohibition

Profiles MUST NOT contain:

- OIDC client secrets;
- access, refresh, or ID tokens;
- model API keys;
- private signing keys;
- session cookies;
- personal identity data.

The OIDC client is public. Runtime secrets are created after login and stored only by the active DSH Credential Provider.

## Versioning

Unknown `schemaVersion` values are rejected. During alpha, any field may change between `v1alphaN` versions. A stable `v1` will use additive optional fields for minor releases and a new schema version for incompatible changes. See [Compatibility](compatibility.en.md).
