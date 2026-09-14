# EduWork identity and resource integration (RFC EW-IDENTITY-1)

> Capability scope: quota and activity heartbeat are institution-only extensions. The public package never requests /quota and its resources RPC contains only model metadata. No capability string or configuration flag enables quota in the public package. ECNU retains its existing server wire in a separate package.

> Two integration modes are supported: identity-only OIDC can omit all resource interfaces and use personal API keys. The complete organization-resource mode below adds managed credentials and models; see [Public resource protocol](public-resource-protocol.en.md). The mandatory requirements below apply to complete integration, not identity-only login.

[简体中文](server-integration-contract.md) | **English**

This document is written for identity-platform, model-platform, and integration-test teams. It defines, in API-reference form, the server capabilities required by `dsh-oidc`.

For the goals behind these interfaces and ways to contribute to their evolution, see the [Open Identity and Model Integration Initiative](open-integration.en.md). This specification remains the implementation and integration reference; the initiative does not change existing fields, paths, or compatibility rules.

Status: implemented client wire specification, not an IETF standard. Source code and HTTP contract tests determine current behavior. Section 10 provides curl examples; section 11 contains **unimplemented optional proposals**. Every client is a local, single-user Runtime; this is not a shared Web-login architecture.

| Capability | Required interfaces | Optionality and implemented behavior |
| --- | --- | --- |
| Identity | Discovery, Authorization, Token, JWKS, UserInfo | No resource API needed; personal model keys remain available |
| Managed models | Identity, Bootstrap, Key lifecycle, Chat Completions | Enabled by keyBinding/provider together; provisioning requires user consent |
| Model discovery | GET /models | Required only for modelSource=discovery |
| Token refresh/revocation | Refresh grant / Discovery revocation_endpoint | Optional; missing refresh means signing in again after expiry |
| Remote Profile discovery, remote model-key logout | Section 11 proposals | Not automatically requested by the public client |

Optional interfaces still require valid fields when implemented. Quota belongs to the ECNU institution extension and is not a public integration requirement. An identity-only integration must not be represented as complete model integration. Trusted local configuration owns branding, issuer, service origins and model policy. Bootstrap does not overwrite configuration or load executable extensions. No school-specific service is required.

Servers must implement the complete fields and constraints in this document and OpenAPI. Client tolerance for some legacy missing values does not waive server security requirements.

“MUST”, “MUST NOT”, “SHOULD”, and “MAY” are normative. The OIDC interfaces follow OpenID Connect and OAuth 2.0; Key Binding is the fixed protocol defined by this project; the model gateway uses an OpenAI Chat Completions-compatible interface.

## 1. Integration scope

A complete **institutional enterprise-model integration service** MUST provide all three interface groups:

| Interface group | Purpose | Enterprise Profile configuration | Requirement |
| --- | --- | --- | --- |
| OIDC Provider | Login, user identity, and OIDC Access Tokens | `oidc.issuer`, `oidc.clientId`, `oidc.scopes` | Complete implementation required |
| Key Binding | Bind an authenticated user to a revocable model runtime credential | `keyBinding.baseURL` | All four operations required |
| Model gateway | Invoke enterprise models with the bound runtime credential | `provider.baseURL`, `provider.id`, `provider.models` | Chat Completions required |

“One service” means one complete product-delivery, versioning, security, and operational boundary. It does not require every endpoint to share a hostname, gateway, or process. An institution may internally separate its identity platform, user center, and model platform, but it cannot deliver only one part and claim a complete `dsh-oidc` integration.

The following arrangements do not conform:

- OIDC alone, followed by distribution of one global model API key to all users;
- Key Binding that trusts an employee number, name, or subject supplied by the client;
- a model URL and catalog without user authorization and credential lifecycle management;
- a Key Binding service missing any of `bootstrap`, `provision`, `resolve`, or `renew`.

## 2. Addresses and client registration

### 2.1 Three service entry points

An Enterprise Profile declares the three entry points separately:

```json
{
  "oidc": {
    "issuer": "https://id.example.edu/oidc",
    "clientId": "dsh-web-public-client",
    "scopes": ["openid", "profile", "offline_access"]
  },
  "keyBinding": {
    "baseURL": "https://ai.example.edu/api/worker/v1"
  },
  "provider": {
    "id": "example-ai",
    "baseURL": "https://ai.example.edu/open/api/v1",
    "adapter": "openai-compatible",
    "models": [
      { "id": "example-model", "input": ["text"] }
    ]
  }
}
```

In production, `issuer`, `keyBinding.baseURL`, and `provider.baseURL` MUST use HTTPS. URLs MUST NOT contain credentials or fragments, and base URLs MUST NOT depend on query parameters to alter routing behavior.

### 2.2 OIDC Public Client

The identity platform MUST register a Public Client without a Client Secret and enable:

- Authorization Code Flow;
- PKCE `S256`;
- the `openid` and `profile` scopes;
- `offline_access` and the corresponding authorization policy when Refresh Tokens are required.

Desktop callbacks use an available random loopback port by default:

```text
http://127.0.0.1:<actual-port>/oauth/callback
```

Constraints:

- the host is fixed to `127.0.0.1`, not `localhost`, a LAN address, or a public hostname;
- the path is fixed to `/oauth/callback`;
- Desktop uses an available loopback port chosen for each attempt (RFC 8252). The authorization server MUST support this native-client registration pattern; `3080` below is only an example. `desktop.callbackPort` optionally fixes the port and fails clearly on conflicts. Web validation uses its actual WebServer port;
- this is the browser's return address to the user's local DSH process, not an institutional server address;
- the current implementation is a local single-user client and does not support a shared public-Web callback.

## 3. API summary

| ID | Method | Address | Authentication | Required |
| --- | --- | --- | --- | --- |
| OIDC-01 | `GET` | `{issuer}/.well-known/openid-configuration` | None | Yes |
| OIDC-02 | `GET` | Discovery `authorization_endpoint` | User login session | Yes |
| OIDC-03 | `POST` | Discovery `token_endpoint` | Authorization Code + PKCE | Yes |
| OIDC-04 | `GET` | Discovery `jwks_uri` | None | Yes |
| OIDC-05 | `GET` | Discovery `userinfo_endpoint` | OIDC Bearer Access Token | Yes |
| OIDC-06 | `POST` | Discovery `revocation_endpoint` | OIDC Token | Recommended |
| KEY-01 | `GET` | `{keyBinding.baseURL}/bootstrap` | OIDC Bearer Access Token | Yes |
| KEY-02 | `POST` | `{keyBinding.baseURL}/runtime-credential/provision` | OIDC Bearer Access Token | Yes |
| KEY-03 | `POST` | `{keyBinding.baseURL}/runtime-credential/resolve` | OIDC Bearer Access Token | Yes |
| KEY-04 | `POST` | `{keyBinding.baseURL}/runtime-credential/renew` | OIDC Bearer Access Token | Yes |
| MODEL-01 | `POST` | `{provider.baseURL}/chat/completions` | Runtime API Key | Yes |
| MODEL-02 | `GET` | `{provider.baseURL}/models` | Runtime API Key | If `modelSource=discovery` |

The loopback callback and local `oidcAccounts.*` RPC methods belong to the client, not the enterprise server.

## 4. OIDC interface group

### OIDC-01: Discovery

Reads OIDC Provider metadata.

#### Request

```http
GET /oidc/.well-known/openid-configuration HTTP/1.1
Host: id.example.edu
Accept: application/json
```

When the issuer itself has a path, the Discovery address is:

```text
{issuer-without-trailing-slash}/.well-known/openid-configuration
```

#### Success response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "issuer": "https://id.example.edu/oidc",
  "authorization_endpoint": "https://id.example.edu/oidc/authorize",
  "token_endpoint": "https://id.example.edu/oidc/token",
  "jwks_uri": "https://id.example.edu/oidc/jwks",
  "userinfo_endpoint": "https://id.example.edu/oidc/userinfo",
  "revocation_endpoint": "https://id.example.edu/oidc/revoke",
  "code_challenge_methods_supported": ["S256"],
  "id_token_signing_alg_values_supported": ["RS256"]
}
```

#### Field requirements

| Field | Required | Requirement |
| --- | --- | --- |
| `issuer` | Yes | Exact string match with Enterprise Profile `oidc.issuer` |
| `authorization_endpoint` | Yes | Absolute HTTPS URL |
| `token_endpoint` | Yes | Absolute HTTPS URL |
| `jwks_uri` | Yes | Absolute HTTPS URL |
| `userinfo_endpoint` | Yes | Required by this interoperability profile |
| `revocation_endpoint` | No | When present, the client attempts revocation during logout |
| `code_challenge_methods_supported` | Yes | MUST contain `S256` |
| `id_token_signing_alg_values_supported` | Should | SHOULD contain `RS256`; the actual ID Token MUST use RS256 |

Discovered endpoints may use different HTTPS origins. Development HTTP is accepted only for the single explicitly configured development origin or a loopback origin.

### OIDC-02: Authorization

The browser starts Authorization Code Flow with PKCE.

#### Request

```http
GET /oidc/authorize?
  response_type=code&
  client_id=dsh-web-public-client&
  redirect_uri=http%3A%2F%2F127.0.0.1%3A3080%2Foauth%2Fcallback&
  scope=openid%20profile%20offline_access&
  state=<random-state>&
  nonce=<random-nonce>&
  code_challenge=<base64url-sha256>&
  code_challenge_method=S256 HTTP/1.1
Host: id.example.edu
```

#### Query parameters

| Parameter | Requirement |
| --- | --- |
| `response_type` | Fixed to `code` |
| `client_id` | Equal to Profile `oidc.clientId` |
| `redirect_uri` | Exact match with the registered loopback callback |
| `scope` | At least `openid profile` |
| `state` | Generated by the client and returned unchanged |
| `nonce` | Generated by the client and included in the corresponding ID Token |
| `code_challenge` | PKCE challenge |
| `code_challenge_method` | Fixed to `S256` |

#### Success redirect

```http
HTTP/1.1 302 Found
Location: http://127.0.0.1:3080/oauth/callback?code=<authorization-code>&state=<original-state>
```

An RFC 9207 `iss` response parameter MAY also be returned. When present, it MUST equal the Profile issuer.

#### Error redirect

```text
http://127.0.0.1:3080/oauth/callback?error=access_denied&error_description=...&state=<original-state>
```

The server MUST NOT omit `state`. An Authorization Code MUST be single-use, short-lived, and bound to the client, redirect URI, and PKCE challenge.

### OIDC-03: Token

The client exchanges an Authorization Code and PKCE verifier for tokens. The Public Client does not send a Client Secret.

#### Authorization Code request

```http
POST /oidc/token HTTP/1.1
Host: id.example.edu
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=authorization_code&
client_id=dsh-web-public-client&
code=<authorization-code>&
redirect_uri=http%3A%2F%2F127.0.0.1%3A3080%2Foauth%2Fcallback&
code_verifier=<pkce-verifier>
```

#### Success response

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "access_token": "<oidc-access-token>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "<signed-id-token>",
  "refresh_token": "<optional-refresh-token>",
  "scope": "openid profile offline_access"
}
```

| Field | Required | Requirement |
| --- | --- | --- |
| `access_token` | Yes | Non-empty; used for UserInfo and Key Binding |
| `token_type` | Yes | `Bearer`, case-insensitive |
| `expires_in` | Should | Positive seconds; the client uses 3600 seconds when absent |
| `id_token` | Yes | RS256-signed JWT |
| `refresh_token` | No | Recommended when `offline_access` is enabled |
| `scope` | No | Actually granted scopes |

The ID Token MUST contain at least:

| Claim | Requirement |
| --- | --- |
| `iss` | Equal to Profile `oidc.issuer` |
| `aud` | Contains `oidc.clientId`; with multiple audiences, `azp` MUST equal that client ID |
| `sub` | Non-empty, stable user identifier |
| `iat`, `exp` | Valid NumericDate values |
| `nonce` | Exact match with the Authorization request |
| `nbf` | Optional; valid when present |
| `at_hash` | Optional; MUST match the Access Token when present |

The JWT header MUST use `alg=RS256` and contain a non-empty `kid`.

#### Refresh Token request

```http
POST /oidc/token HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Accept: application/json

grant_type=refresh_token&
client_id=dsh-web-public-client&
refresh_token=<refresh-token>
```

The response MUST contain at least a new `access_token`, `token_type=Bearer`, and valid `expires_in`. When Refresh Token rotation is used, it SHOULD also return a new `refresh_token`. An `invalid_grant` response causes the client to clear its local OIDC session and model runtime credential.

#### Error response

Token errors follow OAuth 2.0:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json
Cache-Control: no-store

{
  "error": "invalid_grant",
  "error_description": "Authorization code is invalid or expired"
}
```

### OIDC-04: JWKS

Publishes the public signing keys needed to verify ID Tokens.

#### Request

```http
GET /oidc/jwks HTTP/1.1
Accept: application/json
```

#### Success response

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "signing-key-2026-01",
      "use": "sig",
      "alg": "RS256",
      "n": "<base64url-modulus>",
      "e": "AQAB"
    }
  ]
}
```

The `kid` used by an ID Token MUST identify exactly one RSA signing key. During rotation, the old public key SHOULD remain available until every valid Token signed by it has expired.

### OIDC-05: UserInfo

Returns the standard user identity represented by the current Access Token.

#### Request

```http
GET /oidc/userinfo HTTP/1.1
Authorization: Bearer <oidc-access-token>
Accept: application/json
```

#### Success response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "sub": "user-12345",
  "name": "Example User"
}
```

| Field | Required | Purpose |
| --- | --- | --- |
| `sub` | Yes | Exact match with ID Token `sub` |
| `name` | Should | Human-readable UI label; the client falls back to `sub` when absent or empty |

The server SHOULD provide the standard `name` claim directly. `dsh-oidc` does not call private institutional directory APIs or support JSONPath name mapping. Other standard claims may be returned, but they cannot replace `sub` for binding.

### OIDC-06: Revocation (recommended)

When Discovery publishes a `revocation_endpoint`, the client submits its Refresh Token during logout, or its Access Token when no Refresh Token exists.

```http
POST /oidc/revoke HTTP/1.1
Content-Type: application/x-www-form-urlencoded

token=<refresh-or-access-token>&client_id=dsh-web-public-client
```

Remote revocation is best-effort during logout. The local OIDC session and runtime credential are cleared whether or not the remote call succeeds. Remote revocation of the model runtime API key remains the responsibility of Key Binding and model-platform lifecycle policy.

## 5. Key Binding interface group

### 5.1 Common conventions

The relative paths, HTTP methods, and wire field names of all four operations are fixed and cannot be configured in the Profile.

Every request MUST include:

```http
Authorization: Bearer <oidc-access-token>
Accept: application/json
```

The server MUST validate token issuer, audience, expiry, not-before, scopes, subject, account state, and institutional authorization. The subject MUST be derived from the validated Token. A subject, employee number, or name supplied in the request body MUST NOT be trusted as identity.

Recommended scopes:

| Interface | Scope |
| --- | --- |
| KEY-01 Bootstrap | `worker.bootstrap.read` |
| KEY-02 Provision | `worker.credential.provision` |
| KEY-03 Resolve | `worker.credential.read` |
| KEY-04 Renew | `worker.credential.renew` |

An institution may use different scope names, but the actual names MUST be included in Profile `oidc.scopes` and enforced by the server.

### KEY-01: Bootstrap

Reads the Provider, server capabilities, user entitlement, and runtime-credential state. This operation MUST NOT return a model API key.

#### Request

```http
GET /api/worker/v1/bootstrap HTTP/1.1
Host: ai.example.edu
Authorization: Bearer <oidc-access-token>
Accept: application/json
```

#### Success response

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "protocol_version": "worker-user-center/v1",
  "provider": {
    "id": "example-ai"
  },
  "capabilities": [
    "worker.bootstrap.read",
    "worker.credential.provision",
    "worker.credential.read",
    "worker.credential.renew"
  ],
  "runtime_credential": {
    "status": "missing",
    "provisioning": {
      "allowed": true
    }
  }
}
```

#### Response fields

| Field | Required | Description |
| --- | --- | --- |
| `protocol_version` | Optional for legacy; new servers SHOULD provide it | Accepted aliases with identical wire: `worker.user-center.v1`, `worker-user-center/v1`, `eduwork-resources/v1`; unknown versions are rejected |
| `provider.id` | Yes | Exact match with Profile `provider.id` |
| `capabilities` | Yes | String array with at most 256 entries |
| `runtime_credential.status` | Yes | Current credential state |
| `runtime_credential.api_key_id` | Conditional | Recommended for an existing credential; required by Renew |
| `runtime_credential.expires_at` | No | RFC 3339 timestamp |
| `runtime_credential.provisioning.allowed` | No | Whether credential creation is allowed |
| `runtime_credential.provisioning.reason` | No | Non-sensitive user-facing reason, at most 500 characters |
| `subject` | No | Management-plane display only; cannot override OIDC identity |

`runtime_credential.status` values:

| State | Client behavior |
| --- | --- |
| `missing` | Wait for explicit user consent, then call Provision |
| `active` | Call Resolve |
| `expiring` | Call Renew when `api_key_id` exists, otherwise Resolve |
| `expired` | Call Renew when `api_key_id` exists, otherwise Resolve |
| `suspended` | Clear the local runtime credential and do not invoke a model |
| `unavailable` | Clear the local runtime credential and show service unavailable |

### KEY-02: Provision

Creates or binds a runtime credential for the authenticated and authorized subject. Completing the OIDC callback alone does not call this operation; the user must explicitly consent in the UI.

#### Request

```http
POST /api/worker/v1/runtime-credential/provision HTTP/1.1
Authorization: Bearer <oidc-access-token>
Content-Type: application/json
Accept: application/json
Idempotency-Key: 2b9b6c80-7758-4d3f-94c6-b72d91ca8c53

{
  "provider_id": "example-ai"
}
```

| Field/header | Required | Requirement |
| --- | --- | --- |
| `Idempotency-Key` | Yes | One UUID for one logical create operation |
| `provider_id` | Yes | Exact match with Profile `provider.id` |

The idempotency scope MUST include authenticated subject, Provider, and Idempotency-Key. A retry with the same key and payload MUST produce the same logical result. Reusing the same key with a different payload MUST return `409 Conflict`.

#### Success response

See [Common runtime-credential response](#55-common-runtime-credential-response). A first creation MAY return `201 Created`; an existing or completed binding MAY return `200 OK`.

### KEY-03: Resolve

Resolves the active runtime credential already bound to the current subject. Resolve MUST NOT create a new entitlement.

#### Request

```http
POST /api/worker/v1/runtime-credential/resolve HTTP/1.1
Authorization: Bearer <oidc-access-token>
Content-Type: application/json
Accept: application/json

{
  "provider_id": "example-ai",
  "api_key_id": "key-123"
}
```

| Field | Required | Description |
| --- | --- | --- |
| `provider_id` | Yes | Provider ID declared in the Profile |
| `api_key_id` | No | Known credential ID returned by Bootstrap |

Return `404` when no credential can be resolved. The server may rotate opaque secret material while preserving a logical `api_key_id`, but MUST NOT return a credential owned by another subject or Provider.

### KEY-04: Renew

Rotates an expiring or expired runtime credential.

#### Request

```http
POST /api/worker/v1/runtime-credential/renew HTTP/1.1
Authorization: Bearer <oidc-access-token>
Content-Type: application/json
Accept: application/json
Idempotency-Key: 2f94dc48-201a-475e-a61a-69d7880e1186

{
  "provider_id": "example-ai",
  "api_key_id": "key-123"
}
```

`provider_id`, `api_key_id`, and `Idempotency-Key` are all required. The same idempotency rules as Provision apply. After the new credential becomes active, the server SHOULD invalidate the old secret as soon as safely possible and record any necessary overlap window.

### 5.5 Common runtime-credential response

Provision, Resolve, and Renew use the same success structure:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
Pragma: no-cache

{
  "provider_id": "example-ai",
  "api_key": "<secret-runtime-api-key>",
  "api_key_id": "key-123",
  "status": "active",
  "expires_at": "2026-09-01T00:00:00Z"
}
```

| Field | Required | Requirement |
| --- | --- | --- |
| `provider_id` | Yes | Exact match with the request and Profile |
| `api_key` | Yes | Non-empty, at most 16 KiB; used only for the model gateway |
| `api_key_id` | No | Recommended for lifecycle management and audit correlation |
| `status` | Yes | Fixed to `active` |
| `expires_at` | No | RFC 3339 timestamp |

A response containing `api_key` MUST use `Cache-Control: no-store` and SHOULD use `Pragma: no-cache`. Reverse proxies, WAFs, APM agents, application logs, and audit logs MUST redact the Authorization header and `api_key`.

### 5.6 Key Binding error response

Errors SHOULD use RFC 9457 `application/problem+json`:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/problem+json

{
  "type": "https://ai.example.edu/problems/model-entitlement-denied",
  "title": "Model entitlement denied",
  "status": 403,
  "detail": "The current account cannot use this provider",
  "code": "model_entitlement_denied"
}
```

| HTTP status | Meaning |
| --- | --- |
| `400` | Invalid request structure or Provider ID |
| `401` | Missing, invalid, expired, or wrong-audience Access Token; SHOULD include `WWW-Authenticate` |
| `403` | Scope, institutional membership, model entitlement, account state, or provisioning policy denial |
| `404` | No resolvable or renewable credential |
| `409` | Idempotency or credential-lifecycle conflict |
| `429` | Rate limit; SHOULD include `Retry-After` |
| `5xx` | Server failure; response MUST NOT contain a Token or API Key |

`code` SHOULD remain stable for UI and log classification. `detail` may vary but MUST NOT disclose sensitive information.

The machine-readable Key Binding contract is [`protocol/openapi.yaml`](../protocol/openapi.yaml).

## 6. Model-gateway interface group

### MODEL-01: Chat Completions

`dsh-oidc` currently invokes an OpenAI Chat Completions-compatible interface through DSH's official Pi adapter.

#### Request

```http
POST /open/api/v1/chat/completions HTTP/1.1
Host: ai.example.edu
Authorization: Bearer <runtime-api-key>
Content-Type: application/json
Accept: text/event-stream

{
  "model": "example-model",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "max_tokens": 1024
}
```

| Item | Requirement |
| --- | --- |
| Authentication | Accept the `api_key` returned by Key Binding; do not accept an OIDC Token as a substitute |
| `model` | Implement every model ID declared in Profile `provider.models` |
| `messages` | Support the OpenAI Chat Completions message structure |
| `stream` | Streaming responses are required |
| Image input | Required only when the Profile declares `input: ["text", "image"]` for that model |
| Reasoning parameters | Match Profile `reasoning`, `reasoningEfforts`, and `compat` declarations |
| Tools | MUST support `tools`, `tool_choice`, and streamed `tool_calls` for DSH Agent tool use |

#### Streaming success response

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hel"}}]}

data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}

data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

For every runtime API key, the server MUST enforce subject binding, Provider scope, credential state, expiry, revocation, and quota policy when enabled. This server-side policy does not require public quota UI or a `/quota` endpoint. A revoked or rotated old key MUST NOT retain indefinite access.

#### Error response

Errors SHOULD interoperate with OpenAI-compatible clients, for example:

```json
{
  "error": {
    "message": "Runtime credential has expired",
    "type": "authentication_error",
    "code": "credential_expired"
  }
}
```

The gateway SHOULD distinguish at least: `400` invalid request, `401` invalid credential, `403` access denied, `404` unknown model, `429` rate/quota limit, and `5xx` server failure.

Static `modelSource=profile` deployments may omit `/models`; `modelSource=discovery` deployments implement MODEL-02. A missing discovery catalog must not be replaced with invented model IDs.

### MODEL-02: Model catalog

`GET {provider.baseURL}/models`, authenticated with `Authorization: Bearer <runtime-api-key>`, returns HTTP 200 JSON:

```json
{"data":[{"id":"example-model","object":"model","owned_by":"example-ai"}]}
```

`data` contains at most 128 distinct IDs, each 1–256 characters, available to that key. The client consumes IDs only. Profile-reviewed models retain their declared context, input modalities and reasoning effort levels; new IDs default to text input with no reasoning_effort. Additional OpenAI-style fields are ignored. Empty/invalid/unavailable discovery retains the last valid catalog and reports `models_unavailable`. Remote capabilities, arbitrary URLs and executable configuration are not accepted. Accurate advanced capabilities currently belong in the trusted Profile.

## 7. Cross-interface invariants

The service MUST guarantee:

1. UserInfo `sub` exactly equals ID Token `sub`.
2. Key Binding derives the same subject from the Access Token and does not trust request-body identity.
3. Profile `provider.id`, Bootstrap `provider.id`, and runtime-credential `provider_id` are exactly equal.
4. A runtime API key is authorized only for its subject and Provider.
5. Model IDs, input modalities, and reasoning capabilities actually served by the gateway match the Profile.
6. OIDC Tokens are used only for UserInfo and Key Binding; runtime API keys are used only for the model gateway. They are not interchangeable.
7. Account suspension, authorization revocation, and credential rotation propagate to runtime credentials and the model gateway.
8. Logs may contain a correlation ID, opaque subject reference, Provider ID, and `api_key_id`, but never a Token or `api_key`.
9. Bootstrap `subject` data is display-only and cannot override OIDC `sub` or `name`.

## 8. Standard call sequence

```text
Client -> OIDC-01 Discovery
Client -> OIDC-02 Authorization (browser + PKCE)
OIDC   -> 127.0.0.1:<port>/oauth/callback
Client -> OIDC-03 Token
Client -> OIDC-04 JWKS (verify ID Token)
Client -> OIDC-05 UserInfo
Client -> KEY-01 Bootstrap
Client -> KEY-02 Provision (first use with explicit consent)
          or KEY-03 Resolve (active credential)
          or KEY-04 Renew (expiring/expired credential)
Client -> MODEL-01 Chat Completions
```

When the Access Token is close to expiry, the client uses the Refresh Token grant on OIDC-03. Logout clears the local OIDC session and runtime credential and calls OIDC-06 when available.

## 9. Integration acceptance checklist

A complete integration MUST pass at least these tests:

- exact Discovery issuer match, all required endpoints present, and PKCE `S256` advertised;
- callback uses only `127.0.0.1:<actual-port>/oauth/callback`;
- state, nonce, PKCE verifier, ID Token signature, audience, and expiry are validated;
- UserInfo returns a non-empty `sub` matching the ID Token, and `name` displays correctly;
- all four Key Binding operations exist, with Provision, Resolve, or Renew selected from lifecycle state;
- Provision and Renew are idempotent, and incompatible replay returns `409`;
- Provider ID is identical across Profile, Bootstrap, and credential response;
- a Key Binding Access Token cannot call the model gateway, and a model API key cannot call UserInfo or Key Binding;
- expired/revoked runtime credentials, suspended accounts, and unauthorized access are rejected;
- Chat Completions completes at least one streaming text conversation; declared multimodal and reasoning capabilities pass their corresponding tests;
- Tokens, Authorization headers, and `api_key` never appear in URLs, logs, APM, error details, or audit data;
- every failure response has a stable, diagnosable, non-secret error structure.

See [Enterprise Profile](enterprise-profile.en.md) for configuration fields, [OIDC interoperability](oidc-interoperability.en.md) for additional OIDC details, and [Key Binding protocol](key-binding-protocol.en.md) for lifecycle and security semantics.

## 10. Refresh, logout and HTTP request examples

The client refreshes access tokens within 90 seconds of expiry and coalesces concurrent refreshes. A management `401` refreshes and retries once with the same body and idempotency key. `invalid_grant` clears local identity and only a model key still owned by it; transient failures preserve valid credentials. `status` projects state; `reconcile` checks the server.

Normal OIDC/management/resource timeouts are 20 seconds, revocation 10 seconds. Management/resource requests reject redirects. There is no scheduled `Retry-After` retry for management operations; a later user action creates a new idempotency key. Provision must also prevent duplicate active credentials for the same subject/provider.

Logout cancels pending desktop login and clears the profile's identity and model snapshot. It deletes a local managed key only while its saved fingerprint still owns that value, preserving another login's key and personal keys. Revocation is best effort when advertised; browser-wide SSO logout and remote model-key revocation are not implemented. The server remains responsible for denying expired, revoked or disabled credentials.

The following POSIX shell examples contain placeholders; Windows can use WSL. Requests originate in the user's local Runtime, so browser CORS is not needed. Do not put real secrets into shared logs or tickets. `ACCESS_TOKEN` and `RUNTIME_KEY` have different purposes. All OIDC endpoints must come from verified Discovery.

```bash
ISSUER='https://id.example.edu/oidc'
MANAGEMENT='https://ai.example.edu/api/worker/v1'
MODEL_BASE='https://ai.example.edu/open/api/v1'
CLIENT_ID='eduwork-public-client'
REDIRECT_URI='http://127.0.0.1:3080/oauth/callback'
curl --fail-with-body --max-time 20 "$ISSUER/.well-known/openid-configuration"
# Copy these URLs from verified Discovery; their paths are not fixed.
AUTHORIZATION_ENDPOINT='https://id.example.edu/oidc/authorize'
TOKEN_ENDPOINT='https://id.example.edu/oidc/token'
JWKS_URI='https://id.example.edu/oidc/jwks'
USERINFO_ENDPOINT='https://id.example.edu/oidc/userinfo'
REVOCATION_ENDPOINT='https://id.example.edu/oidc/revoke'
curl --fail-with-body --max-time 20 "$JWKS_URI"
```

Authorization must complete in the system browser. The GET below illustrates the request, not a way to bypass institutional login. Generate state, nonce and the verifier with a secure random source; the S256 challenge is BASE64URL(SHA256(verifier)). The original client owns and validates the callback and ID Token.

```bash
curl --get --max-time 20 "$AUTHORIZATION_ENDPOINT" \
  --data-urlencode 'response_type=code' --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "redirect_uri=$REDIRECT_URI" --data-urlencode 'scope=openid profile offline_access' \
  --data-urlencode "state=$STATE" --data-urlencode "nonce=$NONCE" \
  --data-urlencode "code_challenge=$PKCE_CHALLENGE" --data-urlencode 'code_challenge_method=S256'
curl --fail-with-body --max-time 20 "$TOKEN_ENDPOINT" \
  --data-urlencode 'grant_type=authorization_code' --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "code=$CODE" --data-urlencode "redirect_uri=$REDIRECT_URI" --data-urlencode "code_verifier=$PKCE_VERIFIER"
curl --fail-with-body --max-time 20 -H "Authorization: Bearer $ACCESS_TOKEN" "$USERINFO_ENDPOINT"
curl --fail-with-body --max-time 20 -H "Authorization: Bearer $ACCESS_TOKEN" "$MANAGEMENT/bootstrap"
```

Perform only the lifecycle operation selected by Bootstrap. Provision needs user consent. Reuse one idempotency key for retries of a logical write, with a separate key for Renew. `api_key_id` is the string identifier returned by the server. Supply the actual resource scopes described in section 5.1 when the deployment requires them.

```bash
curl --fail-with-body --max-time 20 "$MANAGEMENT/runtime-credential/provision" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" --data '{"provider_id":"example-ai"}'
curl --fail-with-body --max-time 20 "$MANAGEMENT/runtime-credential/resolve" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data '{"provider_id":"example-ai","api_key_id":"key-123"}'
curl --fail-with-body --max-time 20 "$MANAGEMENT/runtime-credential/renew" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $RENEW_IDEMPOTENCY_KEY" --data '{"provider_id":"example-ai","api_key_id":"key-123"}'
curl --fail-with-body --max-time 20 -H "Authorization: Bearer $RUNTIME_KEY" "$MODEL_BASE/models"
curl --no-buffer --fail-with-body "$MODEL_BASE/chat/completions" \
  -H "Authorization: Bearer $RUNTIME_KEY" -H 'Content-Type: application/json' \
  --data '{"model":"example-model","messages":[{"role":"user","content":"Reply with OK"}],"stream":true}'
curl --fail-with-body --max-time 20 "$TOKEN_ENDPOINT" \
  --data-urlencode 'grant_type=refresh_token' --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "refresh_token=$REFRESH_TOKEN"
curl --fail-with-body --max-time 10 "$REVOCATION_ENDPOINT" \
  --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "token=$REFRESH_TOKEN"
```

Skip revocation when Discovery omits the endpoint. The OIDC paths shown are examples, while management suffixes, `/models` and `/chat/completions` are fixed. A code from another browser attempt cannot be exchanged without that attempt's verifier. Validate every ID Token requirement in section 4; base64 decoding alone proves nothing.

## 11. Optional extension proposals — not enabled or called by this release

### 11.1 Remote profile discovery

A future `GET /.well-known/eduwork-configuration` could declare `protocol_version: "eduwork-discovery/v1alpha1"`, an OIDC issuer and resource capabilities. The current client reads its trusted local configuration and does not request this endpoint. Any later import must require explicit trust before adding origins, issuer or permissions; a discovery response must never install code, plugins or arbitrary commands. The existing OIDC Discovery endpoint remains implemented and required for identity; it is a different mechanism.

### 11.2 Institution activity heartbeat

Heartbeat is outside this public protocol. Institution plugins own its private wire and explicit enablement; it is never a login, model, or token-refresh requirement. The public package does not schedule telemetry.

### 11.3 Other separate future capabilities

RP-initiated/global SSO logout, server model-key revocation, dynamic OIDC client registration and remotely advertised advanced model capabilities are not implemented by this release. Omission of these capabilities must not break basic identity or manually configured personal model access.

## 12. Versioning and primary references

Profile schema (`v1alpha1`), resource wire (`v1`), npm package version and DSH runtime version are independent. The accepted Bootstrap aliases `worker.user-center.v1`, `worker-user-center/v1`, and `eduwork-resources/v1` describe the same deployed wire. Missing version is accepted for existing v1 servers; unknown explicit versions fail with a resource-connection error and do not invalidate an already verified identity. New servers SHOULD return an explicit supported version. Additive optional fields may be ignored; removing/renaming fields or changing credentials/scopes requires a new major wire version and reviewed client support. Institution quotas are not part of the public schema.

Primary standards: [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html), [OAuth for Native Apps / RFC 8252](https://www.rfc-editor.org/rfc/rfc8252), [OAuth Security Best Current Practice / RFC 9700](https://www.rfc-editor.org/rfc/rfc9700). This resource protocol complements OIDC; it does not redefine identity validation or infer a model credential from an ID Token.
