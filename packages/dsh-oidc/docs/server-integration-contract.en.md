# Server integration contract

[简体中文](server-integration-contract.md) | **English**

The client consumes two explicit gateway contracts. Discovery declarations must match endpoint behavior. It does not infer token semantics from branding or URLs or fall back to legacy model-key provisioning.

- [LiteLLM native contract 1](gateway-auth/README_EN.md): dynamic registration, Code + PKCE, token-authorized models, refresh and revocation.
- [Experimental oidc-llm 0.1](gateway-auth/experimental-oidc-llm.en.md): explicit registration, identity mode, model resource, API base and scopes; still a draft.
- [Standard identity-only OIDC](oidc-interoperability.en.md): identity profiles do not provide model resources.

## OIDC requirements

Provide matching issuer, authorization, token, JWKS and UserInfo endpoints with public-client S256 PKCE. The client checks state, ID Token signature/claims and UserInfo subject binding. When discovery advertises authorization response iss support, the callback must include the matching issuer.

Catalogs and inference accept the same authorized Access Token. Validated discovery determines API/resource boundaries; the server enforces user permissions, model access and quota. Catalogs use data[].id and inference reuses OpenAI-compatible JSON/SSE.

Token responses provide expiry and refresh credentials. Refresh cannot change the authorized subject or context. Immediate server-side Access Token invalidation on logout is not required; the client clears local access and attempts Refresh Token revocation.

## Quota and compatibility

The public package defines no unified quota, team-management or Key Binding protocol. [Account extensions](account-extensions.en.md) can reuse authorized Host GET transport and existing quota parsers.

Servers may retain Key Binding endpoints for old clients. New clients follow the [migration guide](key-binding-protocol.en.md) and never request model keys. The [catalog OpenAPI](../protocol/resources.openapi.yaml) describes resource operations, not the gateway authentication contract.
