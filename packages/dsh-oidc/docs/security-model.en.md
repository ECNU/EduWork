# Security boundaries

[简体中文](security-model.md) | **English**

Profiles are explicitly configured trusted data. Discovery and token responses cannot select executable modules, inject branding scripts or choose arbitrary request destinations.

- Code + PKCE, one-use state and applicable nonce bind sign-in; desktop callbacks listen only on 127.0.0.1.
- OIDC validates signature, issuer, aud/azp, time, nonce, at_hash and UserInfo subject. ID Tokens returned during refresh are checked against the original identity.
- Validated discovery supplies model API endpoints. Host requests restrict destinations and redirects; extension reads accept bounded relative paths, GET and bounded bodies.
- Tokens stay in Host credential storage, never RPC, configuration, diagnostics or model metadata. Personal keys remain separate.
- Requests bind to authorization context. Logout or reauthorization cancels old calls; late responses cannot restore sessions or leak into another account. Refresh within the same authorization does not cancel valid calls.
- Local logout precedes best-effort Refresh Token revocation. Remote failure cannot restore local access. Servers determine issued Access Tokens' remaining lifetime.

The client no longer creates, reads or migrates organization model API keys. Old profiles are explicitly rejected and migration requires sign-in, without URL/token-shape guessing. Old keys are not bulk-deleted because independent configurations may still use them.

See [Profiles](enterprise-profile.en.md) and [protocols](gateway-auth/README_EN.md). Local Web is not a multi-user service.
