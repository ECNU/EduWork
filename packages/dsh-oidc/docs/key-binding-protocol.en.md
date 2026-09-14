# Worker User Center Key Binding Protocol v1

[简体中文](key-binding-protocol.md) | **English**

## 1. Status and terminology

This document defines `worker-user-center-v1`, the enterprise management protocol used by `dsh-oidc` to bind an OIDC-authenticated subject to a model runtime API key. It is not part of OIDC.

It is part of the managed-model tier of the [server API specification](server-integration-contract.en.md), delivered together with the OIDC Provider and model gateway. Identity-only Profiles do not require Key Binding.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and **OPTIONAL** are interpreted as described by RFC 2119 and RFC 8174.

[`protocol/openapi.yaml`](../protocol/openapi.yaml) is the machine-readable companion contract. If prose and OpenAPI differ, this document controls security and lifecycle semantics; OpenAPI controls field spelling and basic shapes. Such a difference is a specification defect and must be reported.

## 2. Design objectives

The protocol separates three credentials:

- the user's organization password, seen only by the OIDC Provider;
- an OIDC access token, used only against the UserInfo and Key Binding services;
- a model runtime API key, used only by the model Provider route.

The API key is a replaceable, revocable runtime credential—not proof of the user's identity. The Key Binding server is the authorization authority for provisioning and resolving it.

## 3. Base URL and fixed resources

An Enterprise Profile supplies one HTTPS `keyBinding.baseURL`. It MUST NOT contain userinfo, query, or fragment and SHOULD contain a versioned path such as `/api/worker/v1`.

The following paths are fixed relative to that base URL:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/bootstrap` | Read Provider, capabilities, entitlement, and credential state. |
| POST | `/runtime-credential/provision` | Create/bind a credential when state is `missing`. |
| POST | `/runtime-credential/resolve` | Return the active credential. |
| POST | `/runtime-credential/renew` | Rotate an `expiring` or `expired` credential. |

Profiles and users MUST NOT override paths, HTTP methods, field mappings, or credential-reference names.

## 4. Authentication and authorization

Every request MUST use TLS except explicit loopback development. The client sends:

```http
Authorization: Bearer <OIDC access token>
Accept: application/json
```

The server MUST validate at least:

- token signature or introspection result;
- issuer;
- audience intended for the Key Binding service;
- expiry/not-before;
- authenticated subject;
- required operation scope;
- organization membership, account state, and model entitlement.

Recommended scopes are:

| Operation | Scope |
| --- | --- |
| bootstrap | `worker.bootstrap.read` |
| provision | `worker.credential.provision` |
| resolve | `worker.credential.read` |
| renew | `worker.credential.renew` |

A deployment MAY use different scope names, but they remain OIDC authorization policy and are listed in the Enterprise Profile `oidc.scopes`; wire operations do not change.

The server MUST derive the bound subject from the validated access token. It MUST NOT accept a caller-supplied subject ID in a request body.

## 5. Bootstrap

Request:

```http
GET /api/worker/v1/bootstrap HTTP/1.1
Authorization: Bearer …
Accept: application/json
```

Minimum successful response:

```json
{
  "provider": { "id": "example-ai" },
  "capabilities": ["worker.credential.provision"],
  "runtime_credential": {
    "status": "missing",
    "provisioning": { "allowed": true }
  }
}
```

The returned `provider.id` is REQUIRED and MUST exactly equal the Enterprise Profile `provider.id`. A mismatch is a binding failure.

Valid `runtime_credential.status` values are:

- `missing`: no credential is bound;
- `active`: an active credential can be resolved;
- `expiring`: rotate if `api_key_id` exists, otherwise resolve according to server policy;
- `expired`: rotate if `api_key_id` exists, otherwise resolve according to server policy;
- `suspended`: entitlement/account disabled; local credential must not be treated as usable;
- `unavailable`: service cannot currently provide a credential.

`subject` MAY carry informational management-plane display data. The client MUST NOT use it to replace OIDC `sub` or `name`.

`protocol_version`, if present, MUST be `worker.user-center.v1`, `worker-user-center/v1` or `eduwork-resources/v1` (aliases of the same v1 wire; unknown versions are rejected). It is optional during v1 adoption; a future major protocol can require explicit negotiation.

## 6. Provision

The user MUST complete OIDC authentication before provisioning. `dsh-oidc` additionally requires an explicit UI action (`allowProvision: true`) so a callback alone does not silently create a model credential.

```http
POST /api/worker/v1/runtime-credential/provision HTTP/1.1
Authorization: Bearer …
Content-Type: application/json
Idempotency-Key: <UUID>

{ "provider_id": "example-ai" }
```

The server MUST:

- verify `provider_id` is authorized for the subject;
- enforce organization provisioning policy;
- make the operation idempotent for the same authenticated subject, Provider, and Idempotency-Key;
- return the same logical result for a replay during the server's idempotency retention window;
- reject reuse of a key with a different payload as `409 Conflict`;
- never log the returned API key.

## 7. Resolve

```http
POST /api/worker/v1/runtime-credential/resolve HTTP/1.1
Authorization: Bearer …
Content-Type: application/json

{
  "provider_id": "example-ai",
  "api_key_id": "optional-known-id"
}
```

Resolve MUST NOT create a new entitlement. It returns the active credential already bound to the subject or a `404`/policy error. A server MAY rotate opaque secret material while preserving the same logical `api_key_id`, but it must not change Provider ownership.

## 8. Renew

```http
POST /api/worker/v1/runtime-credential/renew HTTP/1.1
Authorization: Bearer …
Content-Type: application/json
Idempotency-Key: <UUID>

{
  "provider_id": "example-ai",
  "api_key_id": "key-123"
}
```

Renew requires `api_key_id`, is idempotent, and rotates or replaces an expiring/expired credential. The server SHOULD invalidate superseded secret material as soon as operationally safe and MUST document any overlap window.

## 9. Credential response

All three successful POST operations return:

```json
{
  "provider_id": "example-ai",
  "api_key": "secret-runtime-value",
  "api_key_id": "key-123",
  "status": "active",
  "expires_at": "2026-09-01T00:00:00Z"
}
```

`provider_id`, `api_key`, and `status=active` are REQUIRED. The client refuses an absent/mismatched Provider or empty key.

Credential responses MUST include `Cache-Control: no-store` and SHOULD include `Pragma: no-cache`. Servers, proxies, APM agents, and WAFs MUST redact Authorization headers and `api_key` response fields. The secret MUST NOT be placed in URLs, error details, analytics events, or audit logs.

## 10. Errors

Errors SHOULD use `application/problem+json` following RFC 9457 with a stable extension field `code`. At minimum:

- `400`: malformed request/Provider ID;
- `401`: missing, invalid, expired, or wrong-audience token;
- `403`: scope, membership, entitlement, suspension, or provisioning policy denial;
- `404`: no resolvable/renewable credential;
- `409`: idempotency or lifecycle conflict;
- `429`: rate limit, preferably with `Retry-After`;
- `5xx`: server failure without secret material.

Clients MUST NOT retry provisioning/renewal without preserving the same Idempotency-Key for the same logical operation. `dsh-oidc` currently performs one call; DSH model request retries are separate and never repeat Key Binding operations.

## 11. Lifecycle and revocation

The Key Binding service SHOULD revoke model credentials when:

- organization membership or entitlement ends;
- the OIDC subject is disabled;
- a credential is rotated;
- a security administrator revokes it;
- its maximum lifetime expires.

Local logout removes the cached model key but does not by itself prove remote revocation. Deployments requiring immediate remote revocation SHOULD add an authenticated management operation in a future protocol version rather than overloading OIDC token revocation.

The model gateway MUST independently enforce API key status, Provider scope, expiration, and quota. Possession of an old key must not bypass the current enterprise policy indefinitely.

## 12. Privacy and audit

The server SHOULD minimize identity data in bootstrap. Audit records SHOULD contain event time, opaque subject reference, Provider ID, operation, outcome, policy reason, request correlation ID, and `api_key_id`—never the API key or OIDC token.

Retention, access control, breach response, and cross-border processing are deployment responsibilities. The protocol does not grant permission to collect additional personal data.

## 13. Conformance checklist

A server is conformant when it:

- implements all four fixed resources;
- authenticates requests with the OIDC access token and never request-body subject data;
- returns exact Provider binding;
- enforces required scopes and organization entitlement;
- implements provision/renew idempotency;
- returns no-store credential responses;
- never logs secrets;
- exposes stable lifecycle states and problem codes;
- passes the repository's OpenAPI contract tests plus organization-specific authorization tests.
