# dsh-oidc

**Sign in with an institution to access the models it authorizes for you.**

> npm package: `@eduwork/dsh-oidc@0.2.3` · DSH development baseline: `0.1.5-rc.1`.

[简体中文](README.md) | **English**

`dsh-oidc` connects [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) clients to institutional sign-in, model credentials, and model catalogs. With managed-model mode enabled, the client obtains and configures authorized institutional models after browser sign-in and any required confirmation. Personal API keys and other models remain available.

We want institutional services to work across more AI clients. The **[Open Identity and Model Integration Initiative](docs/open-integration.en.md)** explains the goal, existing implementation, and ways to participate. Integration follows the contracts below without requiring EduWork's UI or desktop shell.

`dsh-oidc` composes four concerns behind one reviewed, declarative Enterprise Profile:

1. OpenID Connect Authorization Code flow with PKCE for a public client;
2. a fixed enterprise **Key Binding** protocol that exchanges the authenticated OIDC access token for a revocable model runtime credential;
3. a local OpenAI-compatible Provider with optional automatic model discovery; and
4. safe account refresh and sign-out, with optional institution account extensions.

Shared account UI and optional bounded branding accompany these capabilities. Identity-only integration may omit resource APIs, and personal model providers remain available.

The plugin targets a single-user local client. Web is for local validation; `backend: desktop` uses a temporary loopback callback and the host browser service without a persistent WebServer. `backend: native` remains for the legacy account bridge. No backend is tied to a particular shell; see [desktop host integration](docs/desktop-host.en.md).

Integrating your own organization? Read the **[server API specification](docs/server-integration-contract.en.md)** first, then follow the **[getting-started guide](docs/getting-started.en.md)**. The first defines, with requests, responses, fields, and errors, the OIDC + PKCE, Key Binding, and model-gateway capabilities one institutional service must jointly deliver; the second covers configuration, installation, acceptance, and troubleshooting.

## Why this boundary

An organization should be able to integrate DSH without forking DSH, shipping executable configuration, or binding its identity layer to one desktop shell. The organization supplies data and standards-compliant endpoints; the plugin owns the executable adapter and validates that data before use.

```mermaid
flowchart LR
  subgraph Local[Trusted local machine]
    U[Browser] <-->|127.0.0.1 callback| D[DSH + dsh-oidc]
    C[DSH Credential Provider]
    P[Local OpenAI-compatible adapter]
    D --> C --> P
  end
  subgraph Service[One institutional integration service]
    O[OIDC Provider]
    K[Key Binding]
    M[Model gateway]
  end
  D <--> O
  D --> K
  K -->|runtime API key| C
  P --> M
  E[Enterprise Profile JSON] --> D
  X[Optional capability plugin] -->|enterpriseTransforms| P
```

The Enterprise Profile is data only. It cannot name JavaScript modules, inject CSS, install tools or skills, or redefine Key Binding paths and wire fields.

## What is included

- loopback callback `http://127.0.0.1:<actual-port>/oauth/callback`: the WebServer port for Web, a temporary random port by default for desktop;
- OIDC Discovery, PKCE S256, state, nonce, RS256 ID Token validation, UserInfo subject binding, refresh, and optional revocation;
- `userinfo.name` for display, falling back only to the required `userinfo.sub`;
- fixed `worker-user-center-v1` endpoints for bootstrap, provision, resolve, and renew;
- DSH Credential Provider storage for OIDC session material and the runtime API key;
- declarative provider/model catalog and bounded brand tokens;
- shared official model-settings, onboarding, sidebar-account and general-settings slots, with capability-aware operations across local Web and both desktop shells;
- a native backend adapter boundary for desktop products;
- a stable `enterpriseTransforms` service for capabilities such as a text-model image fallback without forking the Provider route.

Not included: an OIDC Provider, a Key Binding server, multi-user session storage, an organization directory, a desktop shell, or remote executable plugins.

## Branding scope

`dsh-oidc` already includes bounded product branding. An Enterprise Profile may declare:

- `productName`, `organizationName`, and a one-to-four-character `mark`;
- an HTTPS or base64 PNG/WebP `logoURL`;
- a six-digit hexadecimal `primaryColor`;
- `loginTitle`, `loginDescription`, and an HTTPS `supportURL`.

These values affect the document title, sidebar brand, conversation hero mark, login/confirmation surfaces, and a bounded set of DSH theme tokens. They cannot inject arbitrary CSS, SVG, scripts, or components, and they do not replace a desktop shell, updater, or institution-specific business pages. See the [Enterprise Profile specification](docs/enterprise-profile.en.md#branding) for limits and security rules.

## Requirements

- Node.js 22 or newer;
- one coherent DeepSeek Harness `0.1.5-rc.1` peer set for this package;
- an OIDC Public Client without a Client Secret: new desktops use `http://127.0.0.1:<actual-port>/oauth/callback`, while local Web validation registers its actual fixed port;
- Discovery metadata with PKCE S256, RS256 ID Tokens, and `userinfo_endpoint`;
- an OIDC service for identity-only mode; managed models additionally require the Key Binding and model gateway in the [server contract](docs/server-integration-contract.en.md);
- a DSH Credential Provider appropriate for the deployment.

The current Web backend is intentionally limited to a trusted, single-user DSH process bound to `127.0.0.1`. It is not a shared public-Web session solution. See [Security model](docs/security-model.en.md).

## Install

Install the exact npm version in a coherent DSH `0.1.5-rc.1` host.:

```bash
dsh plugin --profile web add @eduwork/dsh-oidc@0.2.3
```

For auditing, development, or testing unpublished changes, install from a local checkout instead:

```bash
git clone https://github.com/ecnu/EduWork.git
cd EduWork/packages/dsh-oidc
npm ci
npm run check
dsh plugin --profile web add .
```

The local-path form links the checkout into the DSH `web` Profile, so keep the source directory in place. Team deployments should pin a reviewed, exact npm version and must not mix another DSH prerelease line into the same profile.

Advanced products may instead add it explicitly to their own DSH bundle patch:

```yaml
- insert:
    - id: enterprise-oidc
      name: '@eduwork/dsh-oidc'
      config:
        profilePathEnv: EDUWORK_OIDC_PROFILE
```

Set `EDUWORK_OIDC_PROFILE` to a trusted local JSON file. Start from [`examples/enterprise-profile.example.json`](examples/enterprise-profile.example.json) and validate it with [`schema/enterprise-profile.v1alpha1.schema.json`](schema/enterprise-profile.v1alpha1.schema.json).

Start DSH on the fixed IPv4 loopback host. The public OIDC client must register exactly:

```text
http://127.0.0.1:3080/oauth/callback
```

This installation example uses local Web validation. Its port follows the actual DSH WebServer port; if the operator changes `3080`, registration must match. New desktops use a temporary listener and normally request an available port; see [desktop integration](docs/desktop-host.en.md). The loopback host and callback path stay fixed.

## Configuration surfaces

| Plugin config | Purpose |
| --- | --- |
| `profile` | One inline Enterprise Profile object. |
| `profiles` | An array of inline Enterprise Profiles. Provider IDs must also be unique. |
| `profilePathEnv` | Name of an environment variable containing the trusted JSON profile path. |
| `backend` | `web` (default) for local validation, `desktop` for the shared temporary loopback/native-browser implementation, or legacy `native` for a host-provided `enterpriseAccounts` service. |
| `uiMode` | `standard` (shared model settings plus account/onboarding/branding), `models-only` (shared model settings only), or `external` (no plugin UI). |
| `web.returnPath` | Same-origin absolute path after callback; defaults to `/`. |
| `allowEmptyProfiles` | Allows the plugin service to start with no profile, mainly for composition tests. |

See [Enterprise Profile](docs/enterprise-profile.en.md) for every data field and trust rule.

## Protocol summary

OIDC remains standard OIDC. The plugin does not support custom “userinfo field mapping”: `name` is the standard display claim and `sub` is the guaranteed stable fallback. Identity-only mode requires OIDC and omits both `keyBinding` and `provider`. Managed enterprise keys/models require both fields and the Key Binding/model-gateway services. See the [complete server integration contract](docs/server-integration-contract.en.md).

Given `keyBinding.baseURL = https://ai.example.edu/api/worker/v1`, the only valid operations are:

- `GET /bootstrap`
- `POST /runtime-credential/provision`
- `POST /runtime-credential/resolve`
- `POST /runtime-credential/renew`

The profile cannot change these paths or their fields. [`protocol/openapi.yaml`](protocol/openapi.yaml) is the machine-readable contract; [Key Binding protocol](docs/key-binding-protocol.en.md) defines normative behavior, authorization, idempotency, logging, and lifecycle semantics.

Provider ID determines the runtime route; the default enterprise credential reference is `EDUWORK_API_KEY`. Legacy automatic names are migrated compatibly, while independently managed references remain configurable through `keyBinding.credentialRef`. Verified identity, resource binding and a key fingerprint enforce ownership without changing the server API.

## Development

```bash
npm ci
npm run check
```

Development dependencies and the lockfile pin DSH `0.1.5-rc.1`, without referring to a developer’s installed desktop. `npm run check` verifies the dependency lock and selected DSH Host, Client, Provider, WebServer, credentials, and Typert contracts; rebuilds both plugin faces; runs unit/security-contract tests; validates examples and OpenAPI structure; scans publishable sources for common secrets, personal paths, non-example addresses, and ECNU service endpoints; and inspects the npm tarball.

The repository intentionally keeps Host code as native ESM under `src/host`; `scripts/build-host.mjs` copies it to `lib`. The DSH browser client is bundled as the loader-compatible `lib/client.js`.

The plugin and EduWork product use independent versions. Distribution builds use exact npm versions and integrity; source paths are for development. See [development](docs/development.en.md).

## Documentation

- [Open Identity and Model Integration Initiative](docs/open-integration.en.md)
- [Architecture and boundaries](docs/architecture.en.md)
- [Complete institutional server integration contract](docs/server-integration-contract.en.md)
- [Third-party getting-started guide](docs/getting-started.en.md)
- [Enterprise Profile specification](docs/enterprise-profile.en.md)
- [OIDC interoperability profile](docs/oidc-interoperability.en.md)
- [Key Binding protocol](docs/key-binding-protocol.en.md)
- [Security model and deployment requirements](docs/security-model.en.md)
- [DSH integration and extension seams](docs/dsh-integration.en.md)
- [ECNU reference composition](docs/ecnu-reference.en.md)
- [Compatibility and release policy](docs/compatibility.en.md)
- [Public release checklist](docs/release-checklist.en.md)
- [Contribution guide](CONTRIBUTING.en.md), [security policy](SECURITY.en.md), and [governance](GOVERNANCE.en.md)

## License and trademarks

Code and original documentation are licensed under MIT. Dependency notices are in [THIRD_PARTY_NOTICES.en.md](THIRD_PARTY_NOTICES.en.md).

DeepSeek Harness and DeepSeek are names of their respective owners. “华东师范大学”, “ECNU”, “ChatECNU”, and associated marks remain the property of their respective rights holders. The ECNU file in `examples/` is a placeholder reference configuration, contains no production endpoint or client identifier, and does not grant trademark rights.

Source, issues and PRs are maintained in [EduWork](https://github.com/ecnu/EduWork/tree/main/packages/dsh-oidc). Run development commands from `EduWork/packages/dsh-oidc`. npm installation remains independent. See [package publication](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md).
