# Open identity and model integration

[简体中文](open-integration.md) | **English**

A user can authorize a general-purpose client in the browser and use their model permissions. OIDC verifies identity; the model service explicitly grants Access Token model access. Clients reuse discovery, PKCE, refresh and the model Provider.

There are two model-access routes: the [experimental oidc-llm draft](gateway-auth/experimental-oidc-llm.en.md) and [native LiteLLM OAuth](gateway-auth/litellm-setup.en.md). We are advancing oidc-llm as an open protocol for institutions and interoperability across clients; ChatECNU uses this route. The LiteLLM adapter directly supports the existing gateway's native authorization contract.

oidc-llm 0.1 remains under review. An experimental implementation does not make it a finalized standard or an official OpenID standard. See the [protocol draft](gateway-auth/oidc-llm-draft.en.md) for the full proposal and the experimental guide for the implemented scope. The draft's `oidc` and `oauth` options are identity modes. Separately retained identity-only OIDC sign-in provides no model access and is not a third model-access route. Personal models remain independently configurable.

New clients no longer consume Key Binding. Servers may support token model access alongside old client endpoints without retaining old logic in new clients. Institution quota, team policy, web pages and operations remain extensions using bounded Host transport.

Start with the [server contract](server-integration-contract.en.md), [profiles](enterprise-profile.en.md) and [development guide](development.en.md).
