# Gateway authentication

[简体中文](README.md) | **English**

This branch adds LiteLLM native OAuth and an [experimental oidc-llm adapter](experimental-oidc-llm.en.md), disabled by default. Neither is included in a published npm package or desktop Release yet. Existing `oidc` profiles retain their OIDC and optional Key Binding behavior. **oidc-llm** remains a [draft](oidc-llm-draft.en.md); the experiment does not finalize the protocol.

## Choose a connection

| Server | Configuration | Model credential | Client registration |
| --- | --- | --- | --- |
| Existing OIDC/resource service | Existing `oidc`, optional `keyBinding` + `provider` | API Key obtained through Key Binding | Pre-registered public client |
| LiteLLM 1.101.0 native contract 1 | `auth.discoveryUrl` | Login Access Token | Dynamically register the actual callback on each login |
| Experimental oidc-llm 0.1 | `auth` with explicit opt-in and identity mode | Access Token | Static public client implemented |

Quota standardization and team management are outside this integration. LiteLLM handles its own team choice in the gateway page; the adapter retains its opaque authorization context solely to detect an unexpected identity change during refresh. An ordinary OIDC Access Token does not automatically authorize model inference.

## Configuration

In a build containing this feature, add this object to `organizations` in `config/eduwork.jsonc`, or `profiles` when using the plugin directly:

```json
{
  "schemaVersion": "dsh-oidc/v1alpha1",
  "id": "example-gateway",
  "displayName": "Example model gateway",
  "auth": {
    "discoveryUrl": "https://gateway.example.org/.well-known/litellm-cli-auth",
    "expectedIssuer": "https://gateway.example.org"
  }
}
```

See the [complete Profile example](../../examples/litellm.enterprise-profile.example.json). `discoveryUrl` is the complete configured URL. `expectedIssuer` is optional but recommended. Native discovery requires issuer, resource and auth endpoints on the discovery origin; resource must exactly equal issuer. Production uses HTTPS. Explicit `allowInsecureDevelopment: true` permits loopback HTTP only; `insecureDevelopmentOrigin` does not relax this new protocol to arbitrary HTTP hosts.

`auth` is mutually exclusive with `oidc` and `keyBinding`. Do not supply a static `clientId`, secret, scopes or `provider.baseURL`. The adapter appends `/v1` to the validated issuer, preserving any deployment prefix. An optional `provider` may supply a distinct `id`, display name, context/output limits and reviewed per-model capabilities in `models`; only `modelSource: "discovery"` is supported. The current account's model list determines visibility. Local model metadata cannot grant access to an absent model.

Models with only an ID default to text-only without assumed reasoning support. An empty catalog stays empty; a failed fetch never adopts another account's catalog.

Use `backend: "desktop"` or local `backend: "web"`; the legacy `native` bridge supports existing OIDC profiles only. A direct plugin configuration can use `{"backend":"desktop","profilePathEnv":"EDUWORK_OIDC_PROFILE"}` with the environment variable pointing to a Profile JSON file. The desktop Host supplies `desktopServices.openExternal` and a Credential Provider as described in the [Host guide](../desktop-host.md). Web keeps the existing single-user loopback boundary.

## LiteLLM native contract 1

The wire behavior below is pinned to **LiteLLM v1.101.0**. Endpoints come from discovery; paths are the default deployment examples, not a new specification imposed on LiteLLM.

1. **Discovery:** unauthenticated GET `/.well-known/litellm-cli-auth`, 200 JSON containing integer `contract_version: 1`, `issuer`, `resource`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`; required capabilities are `response_types_supported: ["code"]`, `grant_types_supported` containing code and refresh, `code_challenge_methods_supported` containing `S256`, and token/revocation auth methods containing `none`. Unknown versions, missing capabilities and an `oidc_llm` marker fail explicitly. Detection never depends on a brand in the URL or a missing ID Token. A changed configuration/endpoint binding cannot receive saved tokens.
2. **Registration:** bind an actual `http://127.0.0.1:<port>/oauth/callback`, then POST JSON to the registration endpoint with `client_name: "EduWork"`, `redirect_uris: [actualCallback]`, `token_endpoint_auth_method: "none"`, code/refresh grant types and `response_types: ["code"]`. The 201 response contains `client_id`, `client_id_issued_at`, registered redirects, auth method, grants and response types. The callback must match. This server allows 1–3 redirects of at most 256 characters; EduWork registers one. The opaque client ID is not a user ID; each login registers, while refresh reuses its original ID.
3. **Authorize:** navigate the system browser to the advertised endpoint with `response_type=code`, registered `client_id`, exact `redirect_uri`, random one-use `state`, S256 PKCE challenge and exact discovered `resource`. Omitting resource can enter the MCP flow. Native auth does not supply OIDC ID Tokens or enforce application scopes; the client invents neither nonce/`openid` requirements nor model scopes. Gateway login/consent returns code + state, or `access_denied` + state. The gateway's internal `/authorize/complete` form is not a Host API.
4. **Exchange/refresh:** POST form data to token endpoint. Exchange sends `grant_type=authorization_code`, client ID, code, redirect URI, verifier and resource. Refresh sends `grant_type=refresh_token`, client ID, refresh token and resource. Both return 200 with nonempty `access_token`, `refresh_token`, `token_type: "Bearer"`, positive integer `expires_in`, nonempty `user_id`, and `team_id` (string or null). Access tokens are opaque. The response lifetime is authoritative; default access lifetime in this version is 24 hours and configurable. Rotating refresh tokens are single-use, with a new 14-day expiry on each issuance. Subject and opaque team must remain unchanged during refresh.
5. **Identity/models:** GET `/user/info`, GET `/v1/models`, POST `/v1/chat/completions` all use the Access Token as Bearer. `/user/info` is a native adapter mapping, not an advertised OIDC `userinfo_endpoint`; only matching `user_id` and optional `user_info.user_alias` are projected. Failure falls back to the token subject. Its keys, teams and budgets are never returned wholesale to the renderer. Models use OpenAI-style `data[].id`. Inference reuses the DSH adapter for JSON and SSE with `[DONE]`. No permanent `EDUWORK_API_KEY` copy is created; main and subagents resolve fresh credentials through the shared Host.
6. **Revoke:** POST form `token=<refresh>&client_id=<registeredClient>` to the advertised revoke endpoint. 200 `{}` also covers unknown/expired/repeated tokens under a valid client. Invalid client can return 401; coordination/server failures can return 503/500. **Only the submitted refresh token is revoked, not a whole family or all access tokens.** Access tokens retain the server's expiry behavior. Local logout clears tokens and routes before attempting remote revocation; a failure emits a credential-free warning. This client does not yet persist a revocation retry queue across restarts.

See the [Chinese wire reference](README.md#litellm-native-contract-1-接口) for complete JSON examples. Common token errors include 400 `invalid_request`, `invalid_grant`, `invalid_target`, `unsupported_grant_type`; malformed input can instead use FastAPI 422. 403 permissions, 429 limits and 5xx outages do not generally erase login. Do not claim native tokens have server-enforced inference-only scopes.

The Host merges concurrent refreshes for one authorization and persists the complete rotated pair before use. A still-valid token can survive a temporary refresh outage; an expired token stops. Terminal grant errors or changed refresh identity require sign-in. Credential-bearing requests do not follow redirects. This authentication layer never automatically replays generation or a partially consumed SSE; safe reads may refresh and retry once after 401.

Model calls bind to the current authorization when prepared. After logout or account/authorization replacement, a prepared call cannot acquire the new account's credential, active requests are cancelled, and late response bytes or stream content are discarded. Refresh within the same authorization keeps generation running. This is local client isolation, not immediate server-side Access Token revocation or a guarantee that upstream inference and billing stop at the same time.

## Existing OIDC and the future draft

Existing profiles still validate issuer, PKCE, state, nonce, RS256 ID Tokens and matching UserInfo subject, and retain Key Binding, credential-name migration and refresh behavior. See the [existing server contract](../server-integration-contract.md) and [Profile reference](../enterprise-profile.md). These checks were not weakened for LiteLLM.

The oidc-llm adapter discovers `userinfo_endpoint` and reuses standard subject and identity claims. See [experimental integration](experimental-oidc-llm.en.md) for configuration and actual limits. Scope, lifetimes and revocation guarantees remain under review in the [draft](oidc-llm-draft.en.md). Do not migrate an existing institution configuration before real-server acceptance.

## Validation

Run `npm ci` and `npm run check` in the package. Synthetic tests cover legacy OIDC, discovery validation, real loopback callbacks, refresh races, account/catalog isolation and errors. Live gateway acceptance separately covers browser authorization, ordinary/SSE inference, refresh, restart and logout. An HTTP form driver, simulated near-expiry and a mock inference backend do not prove desktop UI, natural expiry or real inference. Keep test credentials outside the public repository.

Official baseline: [release](https://github.com/BerriAI/litellm/releases/tag/v1.101.0), [native flow](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/proxy/_experimental/mcp_server/gateway_dcr_flow.py), [HTTP routes](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/proxy/_experimental/mcp_server/discoverable_endpoints.py), [proxy credentials](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/proxy/_experimental/mcp_server/proxy_api_credentials.py).
