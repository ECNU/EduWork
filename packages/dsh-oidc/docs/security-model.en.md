# Security model and deployment requirements

[简体中文](security-model.md) | **English**

## Assets

`dsh-oidc` handles:

- OIDC authorization codes, access tokens, refresh tokens, and ID Tokens;
- stable OIDC subject identifiers and optional display claims;
- model runtime API keys;
- organization/provider/model configuration;
- account and capability state.

The organization password is not an asset of this plugin and MUST be entered only into the OIDC Provider.

## Trust boundaries

1. Browser to DSH Host callback/UI.
2. DSH Host to OIDC Provider.
3. DSH Host to Key Binding service.
4. DSH Host to model gateway.
5. Plugin to DSH Credential Provider.
6. Trusted local executable plugin code versus declarative Enterprise Profile data.

The same institution may operate boundaries 2–4, but they remain separate protocol authorities and should use distinct audiences and credentials.

## Security controls in this repository

### OIDC

- Authorization Code + PKCE S256 only.
- Random state, nonce, and verifier.
- Ten-minute pending-flow expiry and bounded flow count.
- Fixed callback path and explicit public origin.
- Duplicate security-parameter rejection.
- RS256 signature/JWK/issuer/audience/azp/subject/nonce/time validation.
- `at_hash` validation when supplied.
- UserInfo `sub` equality with ID Token `sub`.
- Same-origin-only callback return path.
- HTTPS remote endpoints; explicit loopback-only HTTP development exception.
- One MiB maximum for OIDC and Key Binding JSON responses.

### Configuration

- Unknown keys rejected.
- 512 KiB profile bound.
- No remote adapter/module/tool/skill selection.
- Fixed Key Binding paths and fields.
- HTTPS production URLs without embedded credentials/fragments.
- PNG/WebP-only data logos; no SVG data URL.
- Only bounded brand token overrides.

### Secrets

- Public OIDC client; no client secret.
- Session and API key written only through DSH Credential Provider.
- The model adapter resolves the normalized Profile credential reference at request time; deterministic Provider-ID derivation is only the default when none is configured.
- Separate empty pi-ai auth store prevents ambient credentials shadowing the bound key.
- Credential response requires exact Provider ID.
- A native host's reported credential reference must match the Profile, preventing production/test cross-resolution.
- Logout clears both local session and model key.

## Host assumptions

The plugin assumes:

- Node.js TLS and DNS trust are correctly administered;
- DSH plugins and profile files are writable only by trusted administrators;
- the DSH WebServer listens exactly on `127.0.0.1` and exact `/oauth/callback` routing is not bypassed;
- the active Credential Provider protects confidentiality and isolates intended users;
- logs and crash reports do not dump credential values or request bodies;
- no reverse proxy, port forward, or tunnel exposes the local WebServer to other users;
- system time is reasonably synchronized.

If any assumption fails, the plugin alone cannot restore the security boundary.

## Single-user versus shared Web deployment

The Web backend stores one logical OIDC session per profile credential reference. In a local DSH process with a file-backed credential store, that is a **single-user process model**. Multiple browsers reaching the same process could observe or replace the same account state through the shared Host services.

The current Web backend therefore forces the DSH WebServer to listen on `127.0.0.1` and rejects both `publicBaseURL` and non-loopback hosts. It MUST NOT be exposed as a shared multi-user service.

A shared deployment requires the host—not this plugin—to provide:

- authenticated browser sessions;
- per-user service/request context;
- per-user Credential Provider namespaces;
- encrypted storage with rotation and backup policy;
- Secure, HttpOnly, SameSite cookies;
- CSRF protection for non-OIDC state-changing actions;
- tenant/subject isolation tests;
- session termination and administrator revocation;
- rate limiting and abuse monitoring.

Those capabilities require a future, separate host backend; they are not a reason to relax the current Web backend's loopback check. Until DSH exposes and this project tests those contracts, the supported Web topology is one trusted user per process/profile.

## SSRF and endpoint policy

OIDC metadata is remote-controlled after the trusted issuer is configured. The standard permits cross-origin endpoints, so the plugin accepts them only over HTTPS. This prevents an arbitrary network-HTTP downgrade but does not stop a malicious or compromised issuer from naming private HTTPS endpoints.

Operators SHOULD apply egress policy so the DSH process can reach only approved identity, Key Binding, and model origins. Cloud deployments SHOULD block metadata-service ranges and internal control planes at the network layer. DNS rebinding protections belong at the HTTP agent/egress proxy layer and are not implemented here.

## Browser security

The host SHOULD set a restrictive Content Security Policy. At minimum, review:

- `connect-src` for DSH/WebSocket traffic;
- `img-src` for HTTPS and approved `data:` images;
- `frame-ancestors 'none'` unless embedding is explicitly intended;
- `base-uri 'none'` and `object-src 'none'`;
- `Referrer-Policy: no-referrer` or similarly restrictive policy.

Remote brand images can reveal client IP/timing to their host even with no referrer. Package or proxy assets where that is unacceptable.

## Known limitations

- RS256 only; no algorithm agility yet.
- No PAR/JAR/JARM, DPoP, mTLS, or encrypted tokens.
- No RP-Initiated, front-channel, or back-channel logout.
- In-memory pending login state is lost on restart and is not cluster-shared.
- Discovery is cached for the process lifetime; emergency endpoint changes require restart.
- Native backend security depends on the host `enterpriseAccounts` implementation.
- Key Binding has no remote credential-revoke operation in v1.
- Dependency integrity relies on npm lockfile and release controls; the repository does not vendor DSH/pi-ai source.

## Security review checklist for deployments

- [ ] Exact issuer, client ID, redirect URI, and audiences approved.
- [ ] OIDC conformance and negative tests pass.
- [ ] Key Binding scopes and entitlement checks tested for cross-user/cross-tenant access.
- [ ] Provider/key mismatch and stale-key revocation tested.
- [ ] Credential Provider topology matches single-user or isolated multi-user requirements.
- [ ] Reverse proxy and CSP reviewed.
- [ ] Secrets absent from application, proxy, APM, and crash logs.
- [ ] Egress policy blocks unexpected private/metadata destinations.
- [ ] Dependency lockfile, install scripts, and licenses reviewed.
- [ ] Incident response contact and remote credential revocation procedure documented.
