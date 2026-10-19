# dsh-oidc

[简体中文](README.md) | **English**

Sign in with an organization and use its authorized models directly.

The current source supports LiteLLM native OAuth and explicitly enabled experimental oidc-llm 0.1. Both reuse browser/loopback transport, PKCE, Host sessions, refresh, logout and the DSH Provider. Model requests use the current Access Token; this client no longer provisions or stores organization model API keys. Personal API-key settings remain independent.

Version `@eduwork/dsh-oidc@0.3.0` targets Node.js 24.18+ and DSH 0.2.1-rc.2. It supports a standalone local DSH Web profile; no EduWork desktop bridge is required for that backend. Organization model access requires a compatible gateway and a public profile configured by its operator.

```sh
dsh plugin --profile web add @eduwork/dsh-oidc@0.3.0
```

Set `EDUWORK_OIDC_PROFILE` to the absolute path of your profile JSON before starting DSH. The default bundle uses the Web backend. EduWork desktop users continue to use their distribution configuration. Legacy Key Binding profiles require [migration](docs/key-binding-protocol.en.md).

## Getting started

1. Start with the [LiteLLM setup guide](docs/gateway-auth/litellm-setup.en.md) or [experimental oidc-llm](docs/gateway-auth/experimental-oidc-llm.en.md), depending on the server.
2. Copy the [LiteLLM example](examples/litellm.enterprise-profile.example.json) or [OIDC Token example](examples/oidc-llm.enterprise-profile.example.json), then supply the full discovery URL and required public settings.
3. Use backend: desktop for desktop Hosts or backend: web for local Web. [Identity-only OIDC](examples/identity-only.example.json) remains available without organization models.
4. Sign-in discovers the current authorization's model catalog. Passive account refresh must not replace a personal model selected later.

The current source classifies discovered models by `type`; only `llm` enters chat. If the server returns only IDs, supply `provider.models[].type` using actual model IDs before upgrading. Server type metadata takes precedence; specialist and unresolved types remain outside chat. For servers returning only IDs, update the profile model types before enabling the provider. See the [model reference](docs/enterprise-profile.en.md).

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
