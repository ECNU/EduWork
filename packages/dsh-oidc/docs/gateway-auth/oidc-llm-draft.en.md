# oidc-llm 0.1 protocol draft

[简体中文](oidc-llm-draft.md) | **English**

**Status: an open draft with an experimental implementation; not finalized and not an official OpenID standard.** This document derives a reusable model-platform contract from the integration adopted by ChatECNU and the current EduWork adapter. Public clients still require explicit opt-in; see [experimental integration](experimental-oidc-llm.en.md). [Gateway overview](README_EN.md) · [Server integration contract](../server-integration-contract.en.md)

## 1. Scope and flow

Users sign in to their organization in the system browser. A public desktop client obtains Tokens through Authorization Code + PKCE S256, then uses the Access Token directly for user information, model discovery and inference, without obtaining a separate model API key. Other conforming clients can integrate without EduWork branding or school-specific APIs.

For organizational sign-in, full `oidc` identity mode is recommended and is used by EduWork@ECNU. The base `oauth` mode remains available. These are explicit identity choices within one model protocol, without automatic fallback. Ordinary identity-only OIDC does not automatically authorize model calls.

This draft does not define Key Binding, quotas, billing, teams or remote plugin execution. Institution features belong in separate extensions; school-specific model names, concurrency limits and quota fields are not public protocol requirements.

## 2. Discovery

Clients configure a complete discovery URL, an optional `expectedIssuer` and a preregistered public `clientId`. Discovery is an unauthenticated GET returning 200 JSON. This neutral example corresponds to the capabilities currently advertised by ChatECNU; its domain and paths are not mandatory:

```json
{
  "issuer": "https://models.example.org",
  "authorization_endpoint": "https://models.example.org/oauth/authorize",
  "token_endpoint": "https://models.example.org/oauth/token",
  "userinfo_endpoint": "https://models.example.org/oauth/userinfo",
  "revocation_endpoint": "https://models.example.org/oauth/revoke",
  "jwks_uri": "https://models.example.org/oauth/jwks.json",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "scopes_supported": ["openid", "profile", "offline_access", "llm:profile", "llm:models:read", "llm:invoke"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],
  "authorization_response_iss_parameter_supported": true,
  "oidc_llm": {
    "version": "0.1",
    "resource": "https://models.example.org",
    "api_base": "https://models.example.org/open/api/v1",
    "identity_modes_supported": ["oauth", "oidc"],
    "client_registration_methods_supported": ["static"]
  }
}
```

`oidc_llm.version` must match `0.1` exactly; 0.x versions do not promise compatibility. A single `resource` is sent unchanged in authorization, exchange and refresh requests. Append `/models` and `/chat/completions` to `api_base`; the prefix need not be `/v1`. UserInfo and `api_base` must share the resource origin, while the issuer may use a separate login origin. This resource boundary is specific to this draft, not general OIDC.

The current adapter requires the base `oauth` mode to be advertised. Full OIDC deployments additionally advertise `oidc`, JWKS, supported subject types and RS256. OAuth-only deployments do not require OIDC signing metadata, but still need UserInfo, revocation, refresh, PKCE and the corresponding scopes. Both modes use `static` registration and `none` client authentication.

A discovery URL ending in `/.well-known/openid-configuration` must match the standard location for its issuer. `expectedIssuer`, when configured, pins an exact match; otherwise issuer and discovery must share an origin. Production endpoints use HTTPS. Discovery and credential-bearing requests do not follow redirects automatically, except for browser navigation. Authentication endpoints receive only the credentials intended for their role.

Stored authorization binds protocol, issuer, resource, client and related endpoints. Changed bindings require new authorization. Unknown versions, simultaneous LiteLLM and oidc-llm markers, HTML and missing required capabilities fail explicitly; switching protocols, disabling signature checks or forwarding old Tokens cannot bypass validation.

## 3. Client registration

The current integration uses **statically preregistered public clients**. An organization assigns an application client ID, while users authorize individually. The ID is neither a user account nor a secret. Desktop clients do not store a shared client secret.

The server registers allowed callback hosts and paths. EduWork uses `http://127.0.0.1:<random-port>/oauth/callback`, permitting variable loopback ports under RFC 8252 without permitting arbitrary hosts or paths. Exchange uses the same redirect URI as that authorization; refresh reuses its original client ID.

Dynamic registration is outside the current oidc-llm integration requirements. ChatECNU's public discovery advertises only `static`. Any future dynamic extension needs separate discovery, registration authorization and callback rules; copying LiteLLM's registration flow does not establish compatibility.

## 4. Authorization, exchange and identity

| Identity mode | Scopes requested for this connection | Identity validation |
| --- | --- | --- |
| `oidc` | `openid profile offline_access llm:models:read llm:invoke` | Initial authorization requires an ID Token, followed by matching UserInfo |
| `oauth` | `llm:profile llm:models:read llm:invoke` | Reads UserInfo-shaped claims without claiming OIDC authentication |

`llm:models:read` authorizes the user's available catalog and `llm:invoke` authorizes inference. OAuth mode uses `llm:profile` for user information. Full OIDC uses standard identity scopes without additionally requesting `llm:profile`. Other advertised worker, conversation, notebook or administration scopes are not requested automatically. The server must still enforce actual user permissions.

Browser authorization sends `response_type=code`, `client_id`, `redirect_uri`, random `state`, PKCE `code_challenge` / `S256`, `resource` and `scope`. OIDC mode also sends a random `nonce` and `prompt=consent`. Rejection returns `error=access_denied` and the original state. Invalid clients or callbacks must not redirect to untrusted destinations.

Success returns `code` and the original state. When discovery declares `authorization_response_iss_parameter_supported: true`, both success and error callbacks must include an exactly matching `iss`. Codes are short-lived, single-use and bound to subject, client, redirect, PKCE, resource and approved scopes. Their lifetime follows server policy; this draft does not fix it at 120 seconds.

The token endpoint accepts `application/x-www-form-urlencoded` POST:

| Operation | Required fields |
| --- | --- |
| Exchange | `grant_type=authorization_code`, `client_id`, `code`, `redirect_uri`, `code_verifier`, `resource` |
| Refresh | `grant_type=refresh_token`, `client_id`, `refresh_token`, `resource` |

Example initial response for full OIDC mode (Tokens are placeholders; 3600 seconds is illustrative):

```json
{
  "access_token": "OPAQUE_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "OPAQUE_REFRESH_TOKEN",
  "scope": "openid profile offline_access llm:models:read llm:invoke",
  "id_token": "SIGNED_ID_TOKEN"
}
```

Responses should prohibit caching. Access Tokens are opaque Bearer credentials and need not be JWTs. `expires_in` is a positive integer in seconds governed by the server response, with **no 15-minute limit**. The current client separately rejects values exceeding 365 days as a validity bound, not a recommended lifetime. The explicit `scope` must match this connection's requested set without missing, duplicate or additional permissions. OAuth mode returns its corresponding scope and needs no ID Token.

OIDC mode reuses the existing verifier for RS256 signatures, issuer, audience/azp, nonce, time and `at_hash` when present. A missing or invalid initial ID Token fails without OAuth fallback. Refresh may omit an ID Token; when returned, the original subject, audience and related claims are checked, preventing identity changes through refresh.

## 5. UserInfo and model resources

The client sends the same Access Token to the discovered `userinfo_endpoint`, which returns 200 JSON, for example:

```json
{
  "sub": "opaque-user-id",
  "name": "Example user",
  "preferred_username": "example-user"
}
```

Identity is keyed by issuer + sub, never a name or email address. The current adapter requires 1–255 non-whitespace visible ASCII characters for `sub`. Optional `name`, `preferred_username`, `picture` and `email` claims are strings; `email_verified` is boolean. Missing names or avatars do not fail sign-in. Full OIDC requires UserInfo sub to match the verified ID Token, and refresh must preserve the subject. OAuth mode does not present this profile lookup as OIDC authentication.

| Resource | Request and response |
| --- | --- |
| `GET api_base + /models` | Bearer; 200 OpenAI-style `{"object":"list","data":[{"id":"example-chat","object":"model"}]}`, limited to the current authorization |
| `POST api_base + /chat/completions` | Same Bearer; OpenAI-compatible requests with JSON or SSE responses (`data:`, ending with `[DONE]`) |

The server determines model access and quotas; client configuration cannot grant access. Empty catalogs stay empty. Profiles, catalogs and requests are isolated by authorization. ID-only models receive text capabilities without guessing vision, reasoning or context limits from their names; other capabilities require explicit configuration or future metadata.

Image, audio and other APIs need separate agreements between the server and relevant plugins; OpenAI compatibility does not imply every API is supported. Quotas and school services remain institution extensions, not mandatory public endpoints.

## 6. Refresh and long-running streams

A successful refresh returns a complete new Access Token / Refresh Token pair without changing subject or resource or expanding scope. Clients coalesce concurrent refreshes for one authorization and persist the pair before use. Refresh Token lifetime, treatment of old rotated values, reuse detection and family revocation must be documented by the server, not inferred from discovery.

EduWork checks expiry before using authorization, with a margin of `min(30 minutes, half the issued Token lifetime)`. A two-hour Token refreshes when 30 minutes remain; a 20-minute Token when 10 minutes remain. This is a client policy before use, not the server's Token lifetime or a promise of background renewal while the app is closed.

Temporary network failures, 429 and 5xx do not automatically erase login. The client may use a still-valid Token but stops once it expires. Explicit `invalid_grant` / `invalid_client`, changed identity or newly returned credentials that cannot be accepted safely require sign-in. Recovery after a lost rotation response still needs a server contract; unlimited retries of an old Refresh Token are not assumed safe.

**A new Token cannot replace the old Token in an already-sent SSE request.** Refreshing the same authorization does not itself cancel that request. Whether an accepted stream may cross Token expiry must be stated and tested by the server. A 30-minute margin is not an unlimited-duration guarantee. The authentication layer never automatically replays model generation, particularly after output has begun, avoiding duplicate generation and billing.

## 7. Logout, revocation and errors

Logout immediately stops local authorization use, clears credentials and associated model caches, cancels related requests, then attempts Refresh Token revocation. Late refresh, catalog or stream results cannot restore signed-out authorization. This does not sign the user out of the organization's browser SSO session.

The revocation endpoint accepts RFC 7009 form fields `token`, public `client_id` and `token_type_hint=refresh_token`, returning 200 with an empty or JSON response. Revocation prevents subsequent use of the revoked Refresh Token; unknown or expired Tokens are handled idempotently. Clients accept natural server-side expiry of issued Access Tokens without requiring immediate global invalidation. The server must specify whether revocation covers an entire refresh family; this draft does not assume it.

A network failure during revocation does not block local logout; the client logs a sanitized warning. There is currently no persistent revocation retry queue across restarts. Local logout does not imply confirmed remote revocation.

Use OAuth errors `invalid_request`, `invalid_client`, `invalid_grant`, `invalid_scope`, `unsupported_grant_type`, and `invalid_target` for resource mismatch. 401 is an authentication failure, 403 a permission failure, 429 throttling and 5xx a service failure; they must not all become sign-in prompts. Safe reads may refresh and retry once after 401; generation is not replayed automatically. Errors and logs must not disclose credentials.

## 8. ChatECNU reference deployment

ChatECNU is a reference deployment adopting this draft, not the only permitted service. Its public discovery document, checked on 2026-09-25, advertises the following metadata. The institution edition supplies the deployment address, represented here as `{issuer}`; discovery is served at `{issuer}/.well-known/openid-configuration`:

| Item | Public metadata |
| --- | --- |
| issuer / resource | `{issuer}`, identical for both fields |
| Model API base | `{issuer}/open/api/v1` |
| Extension version | `oidc_llm.version: "0.1"` |
| Identity modes | `oauth`, `oidc`; EduWork@ECNU explicitly selects `oidc` |
| Client registration | `static`, public-client authentication `none` |
| Authorization and refresh | Code, PKCE S256, Refresh Token |
| Identity validation | RS256, public JWKS, UserInfo, authorization callback `iss` |

Additional business scopes are advertised, but this connection requests only those in section 4. Editions provide deployment addresses and a public client ID through configuration, not hardcoded public-plugin defaults.

Discovery establishes advertised capabilities, not exact Token lifetimes, refresh-family reuse detection, immediate revocation, filtering for every account or stream behavior at expiry. These require real-server acceptance; an integration test or client implementation is not a complete server guarantee.

## 9. Compatibility and future extensions

LiteLLM native OAuth is another supported model integration route with its own discovery, dynamic registration and account responses. It is not a wire-level subset of this draft. Both adapters share credential storage, refresh coordination and request isolation while preserving protocol differences.

Future work concerns dynamic registration, shared model capability metadata and server contracts for lost refresh responses, Token families and long-running streams. Current integrations can implement and validate this document and the [experimental guide](experimental-oidc-llm.en.md) without waiting for those extensions. Existing deployments still require explicit configuration migration and new authorization.

References: [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html), [OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html), [PKCE](https://www.rfc-editor.org/rfc/rfc7636.html), [native clients](https://www.rfc-editor.org/rfc/rfc8252.html), [Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707.html), [authorization response issuer](https://www.rfc-editor.org/rfc/rfc9207.html), [revocation](https://www.rfc-editor.org/rfc/rfc7009.html).
