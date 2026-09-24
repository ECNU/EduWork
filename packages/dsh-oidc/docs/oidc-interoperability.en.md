# OIDC interoperability profile

[简体中文](oidc-interoperability.md) | **English**

OIDC is the identity tier of the [server API specification](server-integration-contract.en.md). An identity-only Profile may implement this tier alone. Model access uses an explicitly advertised token gateway contract; see [gateway integration](gateway-auth/README_EN.md).

## Standards

The Web backend is a public OpenID Connect Relying Party based on:

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [OAuth 2.0 Authorization Framework (RFC 6749)](https://www.rfc-editor.org/rfc/rfc6749)
- [PKCE (RFC 7636)](https://www.rfc-editor.org/rfc/rfc7636)
- [OAuth 2.0 for Native Apps (RFC 8252)](https://www.rfc-editor.org/rfc/rfc8252)
- [OAuth 2.0 Token Revocation (RFC 7009)](https://www.rfc-editor.org/rfc/rfc7009)
- [OAuth 2.0 Authorization Server Issuer Identification (RFC 9207)](https://www.rfc-editor.org/rfc/rfc9207)

This document states the narrower interoperability choices made by `dsh-oidc`.

## Required Provider behavior

The Provider MUST:

1. publish Discovery at `{issuer-without-trailing-slash}/.well-known/openid-configuration`;
2. return an `issuer` exactly equal to the configured Issuer Identifier;
3. publish `authorization_endpoint`, `token_endpoint`, `jwks_uri`, and `userinfo_endpoint`;
4. advertise `S256` in `code_challenge_methods_supported`;
5. issue RS256 ID Tokens with a non-empty `kid` and a unique matching RSA signing JWK;
6. support Authorization Code flow for a public client without a client secret;
7. return Bearer access tokens and an ID Token from the token endpoint;
8. return JSON UserInfo containing non-empty `sub` equal to the ID Token `sub`.

Discovery endpoints MAY use HTTPS origins different from the issuer, as the standard allows. Network HTTP is rejected. Loopback HTTP is accepted only when the profile explicitly enables development mode and both issuer/endpoint hosts are loopback.

The current implementation supports RS256 only. Providers using ES256, PS256, encrypted ID Tokens, signed UserInfo JWTs, PAR, JAR, DPoP, or mTLS are not yet interoperable.

## Authorization request

The plugin generates cryptographically random:

- 256-bit `state`;
- 256-bit `nonce`;
- 384-bit PKCE verifier and S256 challenge.

Pending flows expire after ten minutes and are limited to 32 per plugin process. Existing query parameters on a discovered authorization endpoint are preserved; protocol parameters are set by the plugin.

The redirect URI is always `http://127.0.0.1:<DSH-port>/oauth/callback`. Host and path are fixed, the port follows the DSH WebServer's actual listening port, and no request or proxy header is used to infer it.

## Callback validation

The callback:

- accepts only the fixed path;
- requires exactly one non-empty `state` and `code` for a successful response;
- rejects duplicate `state`, `code`, `error`, or `iss` parameters;
- consumes a pending state once, even on failure;
- checks RFC 9207 `iss` when present;
- exchanges the code with the original PKCE verifier.

The post-callback `returnPath` must be a same-origin absolute path, preventing an open redirect.

## ID Token validation

The implementation verifies:

- three-part JWS structure;
- protected `alg=RS256` and non-empty `kid`;
- exactly one RSA JWK matching `kid`, optional `use=sig`, and optional `alg=RS256`;
- signature;
- exact `iss`;
- `aud` containing the client ID;
- `azp` equal to the client ID when `aud` contains multiple values;
- non-empty `sub`;
- exact nonce;
- finite required `iat` and `exp`, optional `nbf`, with 60 seconds of clock skew;
- `at_hash` when the claim is present.

TLS trust and DNS resolution remain responsibilities of the Node.js host and operating system.

## UserInfo and display identity

`userinfo_endpoint` is required by this interoperability profile even though its advertisement is not mandatory in every generic OIDC deployment.

The response MUST contain `sub` and it MUST match the verified ID Token `sub`. The account display label is:

1. trimmed standard UserInfo `name`, if non-empty;
2. otherwise trimmed UserInfo `sub`.

The plugin intentionally has no JSON path mapping or private profile endpoint. Organizations SHOULD fix their OIDC UserInfo response to supply the standard `name` claim when a human-readable label is desired.

`affiliation` is currently accepted as an optional display extension; it does not affect authorization. A future stable profile may replace it with a namespaced claim or remove it.

## Refresh and logout

Before requests, the plugin refreshes up to 30 minutes early, capped at half the server-advertised token lifetime. Older sessions with only an expiry gain a refresh timestamp on their first refresh. The actual server-advertised lifetime is never extended. On `invalid_grant`, the stored OIDC session and its still-owned local model credential are removed and login is required. A rotated refresh token replaces the previous one. Sessions without a refresh token remain usable until actual expiry and are then cleared when an active session is next required; entering the early-refresh window does not sign them out prematurely.

Logout attempts RFC 7009 revocation when Discovery publishes `revocation_endpoint`, then removes the OIDC session record and only a model credential still owned by that session. A key written by another profile into the shared reference is preserved. Remote revocation failure is logged without blocking local cleanup.

The plugin does not implement RP-Initiated Logout or front/back-channel logout in this version.
