# Open identity and model integration

[简体中文](open-integration.md) | **English**

A user can authorize a general-purpose client in the browser and use their model permissions. OIDC verifies identity; the model service explicitly grants Access Token model access. Clients reuse discovery, PKCE, refresh and the model Provider.

Current implementations support [LiteLLM native OAuth](gateway-auth/README_EN.md) and the [experimental oidc-llm draft](gateway-auth/experimental-oidc-llm.en.md). An implementation does not make the draft a finalized standard. Personal models and identity-only sign-in remain independent.

New clients no longer consume Key Binding. Servers may support token model access alongside old client endpoints without retaining old logic in new clients. Institution quota, team policy, web pages and operations remain extensions using bounded Host transport.

Start with the [server contract](server-integration-contract.en.md), [profiles](enterprise-profile.en.md) and [development guide](development.en.md).
