# Migrating legacy Key Binding

[简体中文](key-binding-protocol.md) | **English**

The current client source removes Key Binding: it no longer calls /bootstrap or /runtime-credential provision, resolve or renew, and rejects keyBinding profiles and the old backend: native account bridge.

Servers may keep legacy endpoints for already released clients. New clients use Access Tokens for organization models; server compatibility does not require preserving the old client model-key path.

## Migration

1. Confirm [experimental oidc-llm](gateway-auth/experimental-oidc-llm.en.md) or [LiteLLM native](gateway-auth/README_EN.md) server support.
2. Replace oidc + keyBinding + provider.baseURL with a full auth.discoveryUrl. OIDC additionally requires the explicit experimental flag, registered public client ID and identityMode.
3. Preserve stable profile/provider IDs and reviewed model metadata. Validated discovery and catalog responses determine API endpoints and model visibility.
4. Sign in again. The client neither guesses a new discovery URL nor treats saved model keys as Access Tokens, and never silently falls back. It does not read old model keys or bulk-delete keys potentially used elsewhere.
5. Identity-only oidc profiles may remain but cannot include a model provider.

This is a breaking configuration change in unpublished source. Consult historical versions for the retired protocol. Personal API-key settings remain available.
