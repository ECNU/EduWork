# Architecture and boundaries

[简体中文](architecture.md) | **English**

One Host account service composes identity, token lifecycle and the DSH model Provider. Servers own authorization; clients consume explicit contracts.

| Layer | Responsibility |
| --- | --- |
| Profile | Trusted public settings, full discovery URL, protocol opt-in and branding |
| oidc.js / desktop-oidc.js | Shared identity validation, session writes, browser and loopback callback |
| gateway-backend.js | Token resources, single-flight refresh, authorization isolation, logout and catalogs |
| litellm-protocol.js / oidc-llm-protocol.js | Protocol-specific discovery, registration and response validation |
| DSH Provider | Shared requests, JSON/SSE, attachments and reasoning |
| Institution extensions | Optional own-account quota through shared Host transport |

OIDC mode reuses the strict ID Token verifier. LiteLLM native validates its separate identity contract. Both model integrations use Access Tokens without a Key Binding fallback. Plain oidc configuration is identity-only.

After browser Code + PKCE, the Host saves the authorization session and loads its catalog. Requests resolve the current Access Token and share refresh near expiry. Logout, reauthorization or account changes invalidate old calls. Secrets stay in Host credential storage, outside renderer configuration.

See [security](security-model.en.md), [Host integration](dsh-integration.en.md) and [gateway contracts](gateway-auth/README_EN.md).
