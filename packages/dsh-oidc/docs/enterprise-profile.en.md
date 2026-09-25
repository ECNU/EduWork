# Enterprise Profile specification (`dsh-oidc/v1alpha1`)

> Current source accepts token gateway profiles or identity-only OIDC. Key Binding profiles are removed; see [migration](key-binding-protocol.en.md).

[简体中文](enterprise-profile.md) | **English**

## Status and conformance

This document specifies the current unpublished source branch contract. See the migration link above for previously released configurations. The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are interpreted as described by RFC 2119 and RFC 8174.

The canonical machine-readable schema is [`schema/enterprise-profile.v1alpha1.schema.json`](../schema/enterprise-profile.v1alpha1.schema.json). Runtime validation is intentionally stricter in several security-sensitive URL cases. A conforming profile MUST pass both JSON Schema validation and `normalizeEnterpriseProfile()`.

## Trust model

Profiles are trusted deployment configuration, not user input. Nevertheless, the parser is fail-closed:

- unknown keys are rejected at the root and at every executable-relevant nested object;
- total serialized profile size is limited to 512 KiB;
- production URLs require HTTPS;
- development HTTP needs an explicit loopback allowance or exact development-origin allowlist;
- URL credentials, fragments, and endpoint-base query strings are rejected;
- only the built-in `openai-compatible` adapter can be selected;
- logo data URLs accept PNG/WebP only, not SVG.

A remote administration system MAY distribute profile JSON only if the host authenticates the source, verifies integrity, and stages changes through review. Downloaded JSON does not become safe merely because it contains no JavaScript.

## Root object

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | yes | Exact string `dsh-oidc/v1alpha1`. |
| `id` | yes | Profile ID matching `^[a-z][a-z0-9-]{0,63}$`. |
| `displayName` | yes | Human-readable integration name. |
| `organization` | no | Organization label; defaults to `displayName`. |
| `allowInsecureDevelopment` | Optional boolean; `false` (default) accepts HTTPS only, `true` also accepts HTTP service URLs. |
| `insecureDevelopmentOrigin` | Deprecated; accepted in old files but ignored. Omit from new configurations. |
| `brand` | no | Bounded presentational values. |
| `oidc` | identity-only | OIDC public-client facts; cannot include auth or provider. |
| `auth` | models | Full discovery URL; see the gateway guide for explicit protocol fields. |
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

The Web redirect URI is fixed to `http://127.0.0.1:<DSH-port>/oauth/callback`. The host and path are not configurable; the port follows the DSH WebServer's actual listening port.

## Gateway auth

Use [LiteLLM](gateway-auth/README_EN.md) or [experimental oidc-llm](gateway-auth/experimental-oidc-llm.en.md). auth.discoveryUrl is explicit; OIDC mode requires the experimental flag, clientId and identityMode. No model-key fallback is supported.

## Provider object

The Provider object is data interpreted by a local audited adapter.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | DSH route ID, independent of the shared default credential reference. Must be unique across loaded profiles. |
| `displayName` | no | User-facing Provider name. |
| `adapter` | yes | Exact string `openai-compatible`. |
| `baseURL` | not configurable | Derived only from validated gateway discovery. |
| `reasoning` | no | Default DSH/pi-ai reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; default `high`. |
| `defaultContextWindow` | no | Positive safe integer, default 262144. |
| `defaultMaxTokens` | no | Positive safe integer, default 32768. |
| `maxRequestImageBytes` | no | Accumulated native-image request budget. |
| `requestImagePixelBudget` | no | Image normalization pixel budget. |
| `requestImageMaxBytes` | no | Per-normalized-image byte budget. |
| `streamIdleTimeoutMs` | no | Positive idle timeout, default 300000. |
| `retryPolicy` | no | DSH provider-owned retry policy; default normal/2 retries. |
| `compat` | no | Bounded pi-ai OpenAI compatibility facts. |
| `modelSource` | no | Only discovery, the default; fetches /models with the current Access Token. |
| `chatModelIds` | no | Optional allowlist of up to 128 unique chat model IDs, intersected with the authorized server catalog. Omit to leave discovery unfiltered; an empty array registers no chat models. Independent media authorization is unaffected. |
| `models` | no | Reviewed model capabilities; cannot expose models absent from the authorized catalog. |

When `/models` mixes chat, embedding, reranking, image generation and TTS, use `chatModelIds` to select conversational models explicitly. `models` supplies names, modalities and limits, not an allowlist. Selection never guesses type from names or exposes unauthorized IDs. Chat models that accept image input may still be selected. Image generation and speech keep their own service model configuration.

```json
{
  "chatModelIds": ["example-chat", "example-vision-chat"]
}
```

This optional `provider` field works with LiteLLM and oidc-llm. Distribute it only to clients that support it; older clients strictly reject unknown fields.

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
