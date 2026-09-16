# oidc-llm 0.1 protocol draft

[简体中文](oidc-llm-draft.md) | **English**

**Status: for review, not implemented by this client or a server.** The name, extension fields, scopes, lifetimes and revocation requirements are proposals, not a published OpenID standard. Existing OIDC integrations continue to use the [current contract](../server-integration-contract.en.md). [Gateway guide](README_EN.md).

## 1. Scope

After browser sign-in, a public desktop client uses an Access Token to read its own user information, list authorized models and invoke them. Reuse OAuth authorization code, PKCE S256, loopback callbacks and standard OIDC claims. Basic OAuth mode does not require an ID Token; explicit full OIDC mode must still validate one.

Key Binding, quota standardization, teams, billing and remote executable plugins are excluded. An arbitrary ordinary OIDC token must not automatically become a model credential.

## 2. Discovery

Configuration supplies the complete discovery URL, optional `expectedIssuer`, and a public `clientId` for static registration. Account endpoint paths are discovered. An unauthenticated GET returns 200 JSON:

```json
{
  "issuer": "https://login.example.org",
  "authorization_endpoint": "https://login.example.org/oauth/authorize",
  "token_endpoint": "https://login.example.org/oauth/token",
  "revocation_endpoint": "https://login.example.org/oauth/revoke",
  "userinfo_endpoint": "https://models.example.org/userinfo",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["llm:profile", "llm:models:read", "llm:invoke"],
  "oidc_llm": {
    "version": "0.1",
    "resource": "https://models.example.org",
    "api_base": "https://models.example.org/v1",
    "identity_modes_supported": ["oauth"],
    "client_registration_methods_supported": ["static"]
  }
}
```

These fields are proposed as required for basic mode. Version matching is exact; 0.x does not promise cross-version compatibility. There is one model resource, sent unchanged in authorization/token requests. `api_base` is a configurable prefix to which clients append `/models` and `/chat/completions`; `/v1` is not mandatory. This draft puts api_base and UserInfo on the resource origin; issuer may be on a separate sign-in origin. This is a draft-specific restriction, not an OIDC same-origin rule.

OIDC Discovery recommends `userinfo_endpoint`; this profile proposes requiring it. Metadata must advertise the scopes needed for each supported identity mode. Standard discovery locations obey the applicable issuer rules. Explicit expectedIssuer requires exact equality; otherwise the initial issuer shares the discovery origin. Cross-origin hosting requires explicit issuer pinning.

Production endpoints use HTTPS. Discovery and credential-bearing requests do not automatically follow redirects; browser navigation is separate. Trusted metadata assigns each endpoint a role, not permission to receive every token. Saved authorization binds protocol, issuer, resource, client and token/revoke/model endpoints. A changed configuration or binding requires reauthorization, not silent token migration.

Conflicting LiteLLM/oidc-llm markers, unknown versions, HTML and missing capabilities fail explicitly. Never downgrade by disabling ID Token validation.

## 3. Registration

The default institutional arrangement is one preregistered public client ID shared by all installations, with independent user authorizations. No shared client secret belongs in the app. Register the loopback host/path and permit actual port variation as RFC 8252 allows; do not permit arbitrary redirect URLs.

Optional dynamic registration advertises `dynamic` and `registration_endpoint`. Accept an RFC 7591 JSON POST:

```json
{
  "client_name": "EduWork",
  "redirect_uris": ["http://127.0.0.1:53187/oauth/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}
```

Return 201 with registered client ID, redirects, auth method, grants/response types and optional issue time. Version 0.1 automatic DCR covers public registration without a bootstrap secret; deployments requiring initial registration credentials use static registration first. Stateful or stateless registration is allowed; a client per user is not required. Refresh reuses the original registration.

## 4. Authorization and tokens

Proposed basic scopes are `llm:profile`, `llm:models:read`, `llm:invoke`: own profile, authorized catalog and inference. They do not grant key/user/team/billing administration. Model membership remains authorization-specific; server enforcement is required.

Browser GET authorization endpoint includes code response type, client ID, exact redirect URI, random one-use state of at least 128 bits, S256 challenge, resource and scopes. The verifier has 43–128 characters. Consent shows app, account and permissions. Denial returns access_denied + state. Invalid clients/redirects fail directly without navigating an untrusted target.

Success returns opaque code + original state. Proposed code lifetime is at most 120 seconds, one successful exchange, bound to subject, client, redirect, PKCE, resource and scopes.

Token endpoint accepts form POST:

| Operation | Required fields |
| --- | --- |
| Exchange | authorization_code grant, client_id, code, redirect_uri, code_verifier, resource |
| Refresh | refresh_token grant, client_id, refresh_token, resource |

Success example:

```json
{
  "access_token": "OPAQUE_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "OPAQUE_REFRESH_TOKEN",
  "scope": "llm:profile llm:models:read llm:invoke"
}
```

Use `Cache-Control: no-store`. Clients treat access tokens as opaque, use returned expiry and verify granted scopes. A maximum 15-minute Access Token is proposed, pending deployment compatibility review.

Refresh rotates a single-use token and returns the complete new pair. Subject/resource do not change and scopes do not expand. Refresh-family reuse detection and authorization-wide revocation are proposed. Clients coalesce concurrent refresh and persist the pair before use. Lost responses leave uncertain submission state; recovery must be defined without unbounded replay of an old refresh token. Lifetime, coordination and persistence belong in server acceptance.

## 5. UserInfo

GET discovered `userinfo_endpoint` with Bearer; return 200 JSON:

```json
{
  "sub": "opaque-user-id",
  "name": "Example user",
  "preferred_username": "example-user"
}
```

For ordinary JSON UserInfo, **only a nonempty string sub is required**. Name, preferred_username, picture, email and email_verified retain standard OIDC meanings and remain optional under granted permissions. Missing presentation claims do not fail login. Identity uses issuer + sub, never email/name. Account and catalog caches are separated by authorization context.

OAuth-only mode offers a UserInfo-shaped extension without claiming full OIDC identity validation. A profile outage does not necessarily invalidate model authorization, and clients must not parse an unverified token to invent a subject. Full OIDC mode requires UserInfo sub to match the validated ID Token.

## 6. Model resources

- GET api_base + `/models`: Bearer, 200 OpenAI-style `{"object":"list","data":[{"id":"example-chat","object":"model"}]}`, restricted to authorized models.
- POST api_base + `/chat/completions`: same Bearer, OpenAI-compatible ordinary JSON or SSE with `data:` and final `[DONE]`.
- Images, audio, Responses and other capabilities require future explicit declarations; “OpenAI-compatible” does not imply every API is supported.

Optional capability metadata for context/output limits, input modalities and reasoning remains to be agreed. An ID alone does not establish vision/reasoning support. No quota endpoint is defined.

## 7. Revocation and errors

RFC 7009 form POST takes token, public client_id and optional refresh_token type hint. Success is 200 and idempotent for unknown/invalid tokens. Revocation of the authorization's refresh family is proposed. Access tokens expire at their short lifetime unless the server invalidates them sooner; do not promise immediate global sign-out unconditionally.

Local logout immediately stops authorization use and related cache writes. Report remote revocation failures separately. Late refresh/catalog responses cannot restore a signed-out or replaced account.

Use OAuth errors invalid_request, invalid_client, invalid_grant, invalid_scope, unsupported_grant_type and invalid_target for resource mismatch. 401 denotes invalid credentials, 403 denied permission, 429 throttling, 5xx server failures. Do not erase login for every failure. Never refresh and replay a generation after output has begun. Errors must not expose tokens, codes or account secrets.

## 8. Optional full OIDC

Advertise `oidc` identity mode and standard jwks_uri, signing algorithms and required OIDC metadata. Clients explicitly choose it, request openid/profile (optional email) plus model scopes, and use nonce. The basic OAuth llm:profile scope is not additionally required in this mode.

Validate signature, algorithm, issuer, audience/azp, nonce, time and applicable token bindings; UserInfo sub must match. Missing ID Token fails instead of silently switching modes. Existing OIDC validation remains intact and may be reused by the future adapter.

## 9. LiteLLM boundary and open decisions

LiteLLM native is another supported compatibility protocol, not a wire-level subset of this draft. It uses its own discovery, registration and account responses; it lacks the same application scopes, revokes only the submitted refresh token and defaults to longer access lifetime. Adapters preserve these facts instead of attributing proposed guarantees to upstream.

Before implementation, agree scopes and enforcement, lifetimes/family guarantees, capability metadata, and offline/revocation/concurrent-refresh recovery. Confirm protocol and server first, add the new client adapter in a separate PR, then explicitly migrate institution configuration. Existing OIDC users do not switch automatically.

References: [OIDC UserInfo](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo), [Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html), [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html), [PKCE](https://www.rfc-editor.org/rfc/rfc7636.html), [Native apps](https://www.rfc-editor.org/rfc/rfc8252.html), [DCR](https://www.rfc-editor.org/rfc/rfc7591.html), [Resources](https://www.rfc-editor.org/rfc/rfc8707.html), [Revocation](https://www.rfc-editor.org/rfc/rfc7009.html).
