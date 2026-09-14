# EduWork public identity and resource protocol v1

[简体中文](public-resource-protocol.md) | **English**

The public `@eduwork/dsh-oidc` package owns identity login, managed model keys and model configuration. Quota and heartbeat are institution-only extensions; the public package neither requests nor renders quota. Remote speech, institution activity heartbeats and institution-specific tools belong in separate plugins. Each deployment is a local single-user client; the browser connects to the local Runtime.

## Modes and configuration

Identity-only profiles omit both `keyBinding` and `provider`; successful OIDC login completes identity integration. Users configure personal API keys through ordinary DSH model settings. Organization logout leaves those personal credentials alone. See the [identity-only example](../examples/identity-only.example.json).

Full integration includes both fields. `keyBinding.type` defaults to `worker-user-center-v1`, while `eduwork-resources-v1` explicitly names the public resource contract. Both use the existing deployed wire paths; current institutions do not need new endpoint URLs. See the [discovery example](../examples/resources-discovery.example.json).

Both modes permit other models and personal API keys. Optional `brand` only controls presentation; an empty brand leaves the host product name unchanged.

## Endpoints and credentials

| Capability | Endpoint | Authentication |
| --- | --- | --- |
| Identity | OIDC Discovery, Authorization Code + PKCE S256, Token, JWKS, UserInfo | OIDC |
| Credential state | `GET {keyBinding.baseURL}/bootstrap` | OIDC access token |
| Provision, resolve, renew | `POST {keyBinding.baseURL}/runtime-credential/{provision,resolve,renew}` | OIDC access token |
| Models | `GET {provider.baseURL}/models` | Managed model API key |
| Inference | `POST {provider.baseURL}/chat/completions` | Managed model API key |

The [Key Binding OpenAPI](../protocol/openapi.yaml) retains existing lifecycle fields and idempotency requirements. The [resource OpenAPI](../protocol/resources.openapi.yaml) defines model discovery. Optional bootstrap `protocol_version` accepts `worker.user-center.v1`, `worker-user-center/v1` or `eduwork-resources/v1`; unknown versions fail closed. Bootstrap never replaces verified OIDC identity, trusted endpoint configuration or executable components. Resource HTTP requests do not follow redirects.

## Model discovery

`provider.modelSource` defaults to `profile`, preserving reviewed distribution metadata. With `discovery`, `/models` is read after managed key resolution; initial `models` may be omitted and no fake route is registered before discovery.

The response is `{"data":[{"id":"model-a"}]}` with up to 128 unique model IDs. IDs already declared in the trusted Profile retain their capabilities. New IDs are conservatively text-only with reasoning disabled; model names are not capability evidence. Arbitrary URLs, scripts and adapter configuration in remote responses are ignored.

Empty or invalid discovery preserves the last usable catalog and returns `models_unavailable`. Successful discovery replaces the provider snapshot for new calls; prepared calls retain their earlier snapshot. After restart the first signed-in status read rediscovers models. Personal provider routes are unaffected.

## Host integration

The plugin is `@eduwork/dsh-oidc`, with bundle layer ID `enterprise-oidc`. Use `backend: web` and `uiMode: standard` for the public interface; `external` keeps public RPC while allowing a product-owned UI. `allowEmptyProfiles: true` supports a public client using only personal keys.

`EDUWORK_OIDC_PROFILE` names a single profile, an array, or a `{ "profiles": [...] }` file. When absent, `DSH_OIDC_ENTERPRISE_PROFILE` remains a compatible fallback. Explicit `profilePathEnv` names remain supported.

Existing `oidcAccounts.configuration/status/begin/reconcile/logout/management` RPCs remain available. New `resources(profileID)` returns `{profileID, modelSource, models, issues}` without secrets. `reconcile` automatically refreshes model metadata. The legacy native backend does not call its former quota method; new `backend: desktop` shares the Web OIDC implementation but uses a temporary loopback callback without requiring a persistent WebServer.

Institution plugins may call Host-only `ctx.oidcAccounts.authorizedFetch(profileID, endpoint, init)` to reuse the current OIDC access token, refresh and one 401 retry. It returns a regular `Response`, has no Remote marker, and never exposes tokens to the browser. Allowed origins default to the configured issuer and Key Binding origins. Additional exact HTTPS origins require trusted host `authorizedOrigins` configuration and cannot be set by browser RPC. Concurrent requests share one rotating refresh operation. This is an authenticated transport seam, not a heartbeat or speech business protocol.

Host event `oidc/accounts-changed` carries `{profileID, state}`. Both `authenticated` and `connected` mean identity is signed in; identity-only `connected` does not require a model key. `signed_out` means signed out. Authorized requests without a usable identity throw `oidc_login_required`; forbidden origins throw `oidc_authorized_origin_denied`. A second HTTP 401 remains a Response for the caller to handle. Explicit sign-out should not automatically produce an expiry warning.

Changed issuer, client ID or resource endpoints prevent stale managed keys from reaching a different deployment. Existing Web identity records can retain identity while reacquiring the managed model key. Personal API keys remain unaffected by organization logout or resource-binding changes.



Institution account extensions use the [Host transport and account-menu slot contract](account-extensions.en.md). A configured capability string does not activate an extension; install and configure the institution plugin explicitly.
