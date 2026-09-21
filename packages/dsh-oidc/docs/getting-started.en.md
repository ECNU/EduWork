# Integration guide

[简体中文](getting-started.md) | **English**

Organization model requests use the Access Token obtained at sign-in. Choose the actual server contract before configuring the complete discovery URL.

| Service | Example | Registration |
| --- | --- | --- |
| LiteLLM native contract 1 | [LiteLLM](../examples/litellm.enterprise-profile.example.json) | Contract-defined dynamic registration |
| Experimental oidc-llm 0.1 | [OIDC Token](../examples/oidc-llm.enterprise-profile.example.json) | Static public client; explicit oidc or oauth mode |
| Standard identity-only OIDC | [Identity](../examples/identity-only.example.json) | Static public client; no organization models |

OIDC mode requires browser sign-in, Code + PKCE, a valid ID Token and UserInfo. The server must authorize the Access Token for model access; entering a model URL cannot grant permission. See the [server contract](server-integration-contract.en.md).

## Host configuration

Load trusted JSON through config.profile, config.profiles or EDUWORK_OIDC_PROFILE. Desktop uses backend: desktop, Host credential storage and desktopServices.openExternal, with a temporary 127.0.0.1 callback. Local Web uses backend: web with WebServer bound to 127.0.0.1 and its actual port.

This Host integration is published in `@eduwork/dsh-oidc@0.3.0-dev.2` and assembled in EduWork `0.3.6-dev.20260921.1`. Desktop users edit `eduwork.jsonc` using the [LiteLLM setup guide](gateway-auth/litellm-setup.en.md). Other Hosts must pin reviewed package versions; old packages cannot consume these profiles. See [development](development.en.md) for source builds and validation.

## Sign-in and use

1. Complete browser consent. The client checks state, PKCE and applicable identity claims.
2. Discover models and connect the DSH Provider using the same authorization, without model-key provisioning.
3. Refresh near expiry while retaining identity and authorization context.
4. Logout clears local state and stops using the old authorization. Server token lifetime follows deployment policy.

Quota belongs to optional [account extensions](account-extensions.en.md). Use the [migration guide](key-binding-protocol.en.md) for old profiles. Never put passwords, client secrets or user tokens in configuration or logs.
