# Compatibility and release policy

[简体中文](compatibility.md) | **English**

Runtime and DSH compatibility follow package.json, dependency locks and measured results. Source tests are not a complete packaged desktop acceptance.

The current source supports LiteLLM native contract 1, explicitly enabled experimental oidc-llm 0.1 and standard identity-only OIDC. oidc-llm remains a draft and is disabled by default.

This branch removes Key Binding model flows and backend: native account bridging; old profiles fail explicitly. New clients use Tokens while servers may retain legacy endpoints for released clients. This breaking change is unpublished. Choose an appropriate new package version and reviewed product locks before publication; never overwrite an existing npm version.

## Validation

Package checks cover types, builds, shared identity/gateway regressions, schemas, documentation, secrets and packaging. Real OIDC/LiteLLM, desktop encryption, restart and UI require separately identified acceptance evidence.

See [migration](key-binding-protocol.en.md) and [development](development.en.md). Source changes, npm publication, application assembly and production deployment remain separate operations.
