# Experimental oidc-llm integration

[简体中文](experimental-oidc-llm.md) | **English**

The opt-in oidc-llm 0.1 adapter is included in `@eduwork/dsh-oidc@0.3.0-dev.2` and EduWork `0.3.6-dev.20260921.1`, and remains disabled by default. The protocol is still under review. This page describes implemented client behavior; it does not claim that the [complete draft](oidc-llm-draft.en.md) is finalized or that arbitrary servers have passed acceptance.

## Configuration

Add this object to desktop `organizations` or plugin `profiles`. The server must publish the complete `oidc_llm` extension; ordinary OIDC metadata cannot implicitly enable model access.

```json
{
  "schemaVersion": "dsh-oidc/v1alpha1",
  "id": "example-models",
  "displayName": "Example model service",
  "auth": {
    "discoveryUrl": "https://models.example.org/.well-known/openid-configuration",
    "expectedIssuer": "https://models.example.org",
    "experimentalOidcLlm": true,
    "clientId": "replace-with-public-client-id",
    "identityMode": "oidc"
  }
}
```

For organizational sign-in, explicitly select `identityMode: "oidc"`, as EduWork@ECNU currently does. Neither mode falls back to the other:

| Mode | Requested scopes | Identity validation |
| --- | --- | --- |
| `oidc` | `openid profile offline_access llm:models:read llm:invoke`, with consent | Initial RS256 ID Token required; signature, issuer, aud/azp, nonce, time, optional at_hash and UserInfo subject are verified |
| `oauth` | `llm:profile llm:models:read llm:invoke` | Reads sub from the discovered UserInfo-shaped endpoint; does not claim OIDC authentication |

Only static public-client registration is implemented; no client secret is accepted. Registration must allow the actual port to vary in the IPv4 loopback callback `http://127.0.0.1:<random-port>/oauth/callback` while constraining its host and path. Dynamic registration is outside current integration requirements. See the [reference deployment](oidc-llm-draft.en.md#8-chatecnu-reference-deployment) for ChatECNU discovery, endpoints and capabilities. Public examples retain neutral domains; editions supply their own addresses and registered client IDs.

When discovery declares `authorization_response_iss_parameter_supported: true`, both successful and error authorization responses must include `iss` exactly matching the discovered `issuer`. A missing value produces `gateway_callback_issuer_missing`; repeated, empty or mismatched values produce `gateway_callback_issuer_invalid`. The client does not exchange the code. Ask the authentication service administrator to align discovery and callback behavior before starting a new sign-in. The desktop callback listener closes when the flow ends; refreshing an old callback URL cannot resume sign-in.

`allowInsecureDevelopment` is the only HTTP switch, at the profile root beside `auth`/`oidc`. Its default is `false` (HTTPS only); `true` also accepts HTTP service URLs. `insecureDevelopmentOrigin` is obsolete and ignored. Issuer identity, resource-origin validation and OAuth/PKCE checks still apply. `discoveryUrl` is the complete discovery URL; `expectedIssuer` is optional and pins the exact issuer when provided.

## Shared implementation and limits

Both gateway adapters reuse discovery transport, Code+PKCE, browser/callbacks, the Host credential vault, single-flight refresh, model catalogs, the DSH Provider and streaming authorization isolation. The OIDC identity mode directly reuses the existing strict verifier. Standalone identity-only `oidc` remains supported. Legacy model Key Binding has been removed; see the [migration guide](../key-binding-protocol.en.md).

Access tokens stay opaque. Discovered `api_base` and UserInfo must share the resource origin; authentication endpoints only receive their designated credentials, without redirects. Changed configuration/discovery bindings cannot reuse old authorization. Token responses require actual scope, positive integer expiry and a refresh token; grants cannot expand or omit required connection permissions. The server's expiry is honored without a 15-minute limit. The current client accepts 1 second through 365 days as validity bounds, not recommended lifetimes.

Before using authorization, the Host attempts refresh when remaining validity reaches `min(30 minutes, half the issued Token lifetime)`, coalescing concurrent refreshes for the same authorization. This client policy does not change the server's Token lifetime. A new Token cannot replace credentials in an already-sent stream. Stream behavior across expiry requires separate server acceptance; model generation is not replayed automatically.

Refresh may omit an ID Token. If present, its original issuer, subject, audience, optional auth_time and nonce are checked. Failed validation after rotation revokes the new credentials and requires sign-in instead of continuing with a possibly consumed old refresh token. Temporary Token endpoint failures preserve still-valid authorization.

Catalogs retain shared conservative capability mapping: ID-only rows support text without inferred vision or reasoning. Optional draft model capability fields are not consumed yet; use reviewed provider configuration when needed.

Institution extensions can use the existing Host-only `modelResourceFetch(profileID, relativePath)`. Model connections use the current authorized Access Token, sharing path restrictions, GET, bounded bodies and logout isolation. The public plugin makes no implicit quota request and adds no quota RPC/fields. Extensions must be installed explicitly; the server must define and enforce their authorization.

Logout clears local authorization and stops related requests before attempting Refresh Token revocation; 200 empty and JSON responses are accepted. Clients accept natural server-side expiry of issued Access Tokens without requiring immediate global invalidation. Browser SSO is not signed out. Remote failure only produces a sanitized warning; no persistent revocation retry queue exists. Refresh-family reuse detection and revocation scope, scope enforcement, model filtering and stream behavior at expiry require server documentation and acceptance.

References: [OIDC refresh response](https://openid.net/specs/openid-connect-core-1_0.html#RefreshTokenResponse), [authorization response issuer](https://www.rfc-editor.org/rfc/rfc9207.html).
