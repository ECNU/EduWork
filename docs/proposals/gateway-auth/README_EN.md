# Dual-protocol gateway authentication proposal

[简体中文](README.md) | **English**

Status: the LiteLLM native adapter is implemented on this branch but not released; existing OIDC remains compatible. oidc-llm stays a review draft pending agreement and a server implementation. See the [gateway guide](../../../packages/dsh-oidc/docs/gateway-auth/README_EN.md) for implemented configuration and wire behavior, and the [oidc-llm draft](../../../packages/dsh-oidc/docs/gateway-auth/oidc-llm-draft.md) for the proposed protocol. Do not change production configuration based on an unreleased proposal.

## Goal

A complete discovery-document URL should allow EduWork to select between LiteLLM native-client OAuth and a provisionally named `oidc-llm` identity and model-resource protocol. Two adapters share authorization code, PKCE, the system browser, loopback callbacks, access-token lifecycle management and model transport.

After browser authorization, the client uses the authorized access token directly for user information, model discovery and inference. The new protocol does not require a separate API-key creation step. Existing institutional Key Binding integrations retain their compatibility path; Key Binding, quota standardization and team management are outside the new public protocol.

## Discovery and adaptation

| Area | LiteLLM native | Proposed oidc-llm |
| --- | --- | --- |
| Discovery | Validate the complete native contract and version | Explicit versioned extension of standard metadata |
| Registration | Existing gateway dynamic registration | Preregistered institutional public clients; optional dynamic registration |
| Authorization | Code + PKCE S256 with resource | Shared authorization infrastructure with an explicit model resource |
| User information | Adapt the actual account response | Discover userinfo_endpoint and reuse OIDC claims |
| Model access | Direct access-token requests | Direct access-token requests to authorized resources |
| Identity | Native OAuth is not represented as complete OIDC | OAuth compatibility and full OIDC identity modes are explicit |

Protocol selection must not depend on a brand name in a URL, token shape or a missing ID Token. Unknown versions, conflicting markers or missing capabilities fail explicitly. Authorization failures do not trigger a downgrade. An ordinary OIDC access token is not automatically authorized for an unrelated model service.

LiteLLM behavior must be checked against a pinned official implementation. The initial compatibility baseline is native contract 1 in [LiteLLM v1.101.0](https://github.com/BerriAI/litellm/releases/tag/v1.101.0). Scope enforcement and revocation differences remain explicit adapter boundaries.

## UserInfo

The proposal requires userinfo_endpoint in discovery; clients must not construct a fixed user-information path. Ordinary JSON responses require a string sub. Standard name, preferred_username, picture, email and email_verified claims remain optional and subject to authorization. Missing names or pictures do not prevent login.

Account identity uses issuer and sub rather than a name, username or email address. Full OIDC mode compares the UserInfo subject with the validated ID Token. The OAuth-only compatibility mode must describe its different semantics accurately.

References: [UserInfo](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo), [standard claims](https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims), [discovery](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata). Requiring the endpoint is a proposed integration constraint; OIDC does not universally require names or email addresses.

## Implementation boundaries

Shared authentication belongs in packages/dsh-oidc, with desktop host support in the public product. Institutions integrate through deployment configuration and optional extensions, without copying the authentication implementation. Public examples use synthetic addresses and client IDs.

One credential manager owns secure storage, refresh timing, concurrent refresh coalescing, atomic persistence and logout. Main sessions, subagents and plugins obtain current model credentials from it. Responses from a previous account must not update a new authorization context.

Existing configuration and published npm packages retain their current contracts. New adapters require explicit new configuration. Disabling existing OIDC verification or silently converting user-managed static keys into access tokens is outside this design.

## Implementation and acceptance

1. Define discovery/configuration and the shared credential boundary, with synthetic contract tests.
2. Implement the LiteLLM adapter for registration, authorization, account mapping, models, refresh and revocation.
3. Agree on oidc-llm scopes, lifetimes and revocation before implementing its adapter and an independently testable server contract.
4. Verify legacy OIDC profiles, account changes, restarts, ordinary/SSE model requests and failure recovery.

PRs report checks actually performed and unverified behavior. Mock contract tests do not replace gateway and desktop acceptance. Ordinary CI keeps module checks and necessary builds; system-browser and desktop behavior require local validation.

Scopes, token lifetimes, refresh-family revocation guarantees and optional model capability fields remain open design items. Implementation, merging, npm publication and desktop releases are separate steps.
