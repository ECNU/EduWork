# dsh-oidc

[简体中文](README.md) | **English**

Sign in with an organization and use its authorized models directly.

The current source supports LiteLLM native OAuth and explicitly enabled experimental oidc-llm 0.1. Both reuse browser/loopback transport, PKCE, Host sessions, refresh, logout and the DSH Provider. Model requests use the current Access Token; this client no longer provisions or stores organization model API keys. Personal API-key settings remain independent.

These capabilities are published in `@eduwork/dsh-oidc@0.3.0-dev.2` and included in EduWork `0.3.6-dev.20260921.1`. Desktop users edit the bundled `eduwork.jsonc` without installing this npm package separately; see the [LiteLLM setup guide](docs/gateway-auth/litellm-setup.en.md). Legacy OIDC + Key Binding profiles are explicitly rejected; see [migration](docs/key-binding-protocol.en.md). Servers may retain legacy endpoints for older clients.

## Getting started

1. Start with the [LiteLLM setup guide](docs/gateway-auth/litellm-setup.en.md) or [experimental oidc-llm](docs/gateway-auth/experimental-oidc-llm.en.md), depending on the server.
2. Copy the [LiteLLM example](examples/litellm.enterprise-profile.example.json) or [OIDC Token example](examples/oidc-llm.enterprise-profile.example.json), then supply the full discovery URL and required public settings.
3. Use backend: desktop for desktop Hosts or backend: web for local Web. [Identity-only OIDC](examples/identity-only.example.json) remains available without organization models.
4. Sign-in discovers the current authorization's model catalog. Passive account refresh must not replace a personal model selected later.

The current source classifies discovered models by `type`; only `llm` enters chat. If the server returns only IDs, supply `provider.models[].type` using actual model IDs before upgrading. Server type metadata takes precedence; specialist and unresolved types remain outside chat. This requires an updated plugin/client and coordinated configuration, and is not part of the published version above. See the [model reference](docs/enterprise-profile.en.md).

Validate from source:

~~~sh
cd packages/dsh-oidc
npm ci
npm run check
~~~

See [integration](docs/getting-started.en.md) for profile loading, Host composition and server requirements. Released applications use reviewed, published and locked packages; editing this source does not update existing installations.

## Behavior and boundaries

- OIDC validates ID Token signature, issuer, audience, nonce and UserInfo subject. LiteLLM native follows its own contract, without token-shape guessing or protocol fallback.
- Requests check token expiry and refresh near expiry. Concurrent refresh callers share one request.
- Logout removes local authorization, cancels in-flight model requests and attempts Refresh Token revocation. Server policy determines the lifetime of issued Access Tokens.
- Catalogs, JSON/SSE, reasoning and attachments reuse the DSH Provider. Optional [institution extensions](docs/account-extensions.en.md) read quota through shared Host transport.
- Branding accepts bounded data, never remote code. This is a single-user client; Web listens on loopback only.

Further reading: [Profiles](docs/enterprise-profile.en.md), [desktop Host](docs/desktop-host.en.md), [architecture](docs/architecture.en.md), [security](docs/security-model.en.md), [development](docs/development.en.md).
