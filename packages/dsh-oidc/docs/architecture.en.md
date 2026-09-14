# Architecture and boundaries

[简体中文](architecture.md) | **English**

## Goals

`dsh-oidc` lets an organization integrate identity, entitlement, model credentials, Provider metadata, and bounded branding into an ordinary DSH host without forking DSH or requiring a desktop shell.

The design follows five rules:

1. **DSH owns the runtime.** The plugin uses official DSH services and `PiAiAdapter`; it does not implement a parallel conversation or model transport stack.
2. **Standards own identity.** Authentication uses OIDC Discovery, Authorization Code + PKCE, ID Tokens, UserInfo, refresh, and optional revocation.
3. **The institutional service is one complete delivery boundary.** Managed models require one accountable owner to jointly deliver OIDC, fixed Key Binding and the model gateway; identity-only mode requires only OIDC. a Profile declares only their public endpoints and facts.
4. **Configuration is data, not code.** A profile cannot select executable adapters, arbitrary endpoint paths, scripts, stylesheets, tools, or skills.
5. **Product-specific capabilities compose around the core.** The common enterprise-model settings surface belongs to `dsh-oidc`; desktop shells, quota views, model transforms, or institutional pages remain separate plugins/services.

## Runtime components

| Component | Responsibility | Trust level |
| --- | --- | --- |
| DSH Host | Lifecycle, Cordis services, LLM registry, WebServer, credentials, attachments | Trusted executable host |
| `dsh-oidc` Host face | Profile validation, OIDC client, Key Binding client, local Provider registration | Trusted local plugin |
| `dsh-oidc` Client face | Account/onboarding surfaces, shared enterprise-model settings, and bounded branding | Trusted local plugin |
| Enterprise Profile | Declarative integration facts | Trusted configuration, still validated fail-closed |
| Institutional enterprise-model integration service | Joint OIDC identity, Key Binding authorization/credential lifecycle, and OpenAI-compatible model gateway | Remote identity, authorization, and data-processing authority |
| Capability plugin | Optional request-bound transform such as image-to-text fallback | Separately trusted local plugin |

## Control flow

```mermaid
sequenceDiagram
  participant B as Browser/UI
  participant D as dsh-oidc
  participant O as OIDC Provider
  participant K as Key Binding service
  participant C as DSH Credential Provider
  participant L as DSH LLM/PiAiAdapter
  participant M as Model gateway

  B->>D: begin(profileID)
  D->>O: Discovery
  D-->>B: Authorization URL (state, nonce, PKCE)
  B->>O: User authentication and consent
  O-->>D: http://127.0.0.1:port/oauth/callback?code&state
  D->>O: Token request + code_verifier
  D->>O: JWKS and UserInfo
  D->>D: Verify ID Token and sub equality
  D->>C: Store OIDC session
  D->>K: GET /bootstrap with Bearer access token
  B->>D: User confirms provisioning
  D->>K: POST /runtime-credential/provision
  K-->>D: api_key
  D->>C: Store API key under the Profile credential reference
  B->>L: Start model request
  L->>C: Resolve runtime API key
  L->>M: OpenAI-compatible streaming request
```

The OIDC Provider, Key Binding, and model gateway in the diagram are three interface groups in one [server API specification](server-integration-contract.en.md). They may route to different internal systems or origins, managed-model mode needs all three groups, while identity-only mode omits the two model-resource groups. The Web callback always returns to local `127.0.0.1`, not a public institutional DSH address.

## Code layout

- `src/host/index.js`: DSH service entry and Typert remote methods.
- `src/host/oidc.js`: Shared Web/desktop OIDC implementation and the legacy native adapter.
- `src/host/profile.js`: validation, imports, public projection, Provider projection.
- `src/host/provider/`: local DSH/PiAi Provider adapter and transform seam.
- `src/client/`: DSH browser bundle, account surfaces, and remote descriptors.
- `schema/`: machine-readable Enterprise Profile contract.
- `protocol/openapi.yaml`: machine-readable Key Binding contract.
- `docs/`: normative prose, threat model, and integration guidance.

Host files remain readable native ESM and are copied to `lib/` during build. Client code is bundled into DSH's module-loader closure format. Published packages include built artifacts and the two machine-readable contracts.

## Identity boundary

OIDC is the only authentication and identity source in the Web backend, which starts only when the DSH WebServer listens exactly on `127.0.0.1`. The plugin binds three values:

- configured issuer;
- configured public client ID;
- authenticated `sub` shared by the ID Token and UserInfo response.

`userinfo.name` is display-only and falls back to `userinfo.sub`. Key Binding `bootstrap.subject`, if present, is informational and cannot overwrite identity. This prevents a private management API from silently becoming a second, incompatible identity protocol.

## Credential boundary

The Key Binding service returns the model API key exactly once per resolve/provision/renew response. `dsh-oidc` writes it under the normalized Enterprise Profile credential reference. The default is a single institution-neutral reference:

```text
EDUWORK_API_KEY
```

Legacy automatic names normalize to `EDUWORK_API_KEY`; other explicit references remain unchanged. A credential fingerprint is stored alongside verified identity and the complete resource binding in the Host session. Network use and logout cleanup require the current key to belong to that session. The fingerprint is never projected into RPC, logs or conversation text. See the [Profile specification](enterprise-profile.en.md) for migration boundaries.

The Provider adapter resolves that reference at request time. It never reads an ambient pi-ai credential store and never places the key in the Enterprise Profile, UI payload, logs, or DSH transcript. Web and native backends follow the same Profile rule. Native `enterpriseAccounts` is only a host capability adapter; it does not own credential naming, and a conflicting reference is rejected.

Credential storage security is delegated to the active DSH Credential Provider. That is an explicit host contract, not proof that every DSH deployment is multi-user safe.

## Provider ownership and extension

Each profile declares one Provider ID and one or more models. `dsh-oidc` owns those routes through DSH's official `PiAiAdapter` and `@earendil-works/pi-ai` OpenAI Completions implementation.

Optional feature plugins register a transform through the Cordis service `enterpriseTransforms`. A transform may:

- advertise an aggregate modality for a specific Provider/model;
- rewrite the provider-bound request;
- inspect the model's native modalities.

It must not mutate the durable transcript or register a competing adapter for the same route. Native multimodal routes can therefore bypass a text-only image-understanding fallback, while text-only routes can opt into it.

## Desktop and legacy native boundary

New desktop products use `backend: desktop`: a temporary loopback callback and official browser service share the OIDC/Key/model implementation across Wails and Electron. The host supplies credential storage. Legacy `backend: native` delegates to `enterpriseAccounts` only for existing bridges; see [desktop integration](desktop-host.en.md).

The shared UI uses official `settings.models.footer`, onboarding, sidebar and general-settings slots. Institution configuration is read-only trusted data. Legacy bridge mutation methods are compatibility APIs, not a requirement or default UI for new institutions. `models-only` mounts the shared model-settings surface; `external` disables plugin UI. Quota and heartbeat remain in explicitly installed institution extensions.

## Deliberate exclusions

- arbitrary userinfo endpoint or claim-path mapping;
- arbitrary Key Binding paths/fields;
- remote modules, CSS, tools, or skills;
- model quota and institution directory schemas;
- server-side web sessions for a shared multi-user DSH host;
- dynamic Provider adapter selection.

These exclusions reduce protocol ambiguity and keep executable trust local and reviewable.
