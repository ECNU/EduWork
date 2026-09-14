# ECNU reference composition

[简体中文](ecnu-reference.md) | **English**

This repository uses East China Normal University / ChatECNU only as a concrete reference for the generic standard. The public example contains placeholders and no production endpoint, OIDC client identifier, API key, token, personal data, or logo asset.

The reference file is [`examples/ecnu.enterprise-profile.example.json`](../examples/ecnu.enterprise-profile.example.json).

## Intended composition

EduWork@ECNU composes the public core with institution extensions:

```text
DeepSeek Harness
  + dsh-oidc
      - standard OIDC identity
      - worker-user-center-v1 Key Binding
      - ECNU Enterprise Profile
      - declarative ChatECNU Provider/models
      - bounded brand/account UI and shared enterprise-model settings UI
  + ECNU product plugins
      - image-understanding fallback for text-only ecnu-max
      - enterprise search route and official DSH result rendering
      - product presets/skills/resources
      - legacy native account bridge only (new desktops use the public desktop backend)
      - quota or institution-specific business UI
  + desktop shell/packaging/updater
```

New desktop compositions use the public `desktop` backend and host browser service for temporary loopback login; local functional validation uses `web`. The older Wails `native`/`enterpriseAccounts` bridge is a migration compatibility path, not a requirement for another institution. Trusted files manage organization configuration, while UI shows status and sign-in. Explicit institution plugins own quota, heartbeat and campus search; the public package does not request them. All modes follow the `EDUWORK_API_KEY` rules and complete deployment-binding checks without changing the existing OIDC/Key Binding wire.

## Identity expectation

The OIDC Provider should return standard UserInfo:

```json
{
  "sub": "opaque-stable-subject",
  "name": "Display Name"
}
```

If `name` is absent, UI falls back to `sub`. The plugin does not call an ECNU-private profile endpoint and does not map `data.attributes.XM` or similar paths. This is deliberate: the organization OIDC service should expose the standard claim.

## Model example

The placeholder shows two common facts:

- `ecnu-max`: text-only, large context, selectable reasoning efforts;
- `ecnu-plus`: native text/image input, thinking enabled but no selectable reasoning-effort parameter.

For `ecnu-plus`, `supportsReasoningEffort: false` removes the unsupported effort while preserving thinking behavior. For `ecnu-max`, a separate ECNU image-understanding plugin can register `enterpriseTransforms` to add an aggregate image capability without altering the profile or replacing the Provider route.

## Before any public release

ECNU maintainers must separately approve:

- the GitHub organization and repository visibility;
- copyright holder wording;
- use of university/ChatECNU names and brand values;
- public support and security contact addresses;
- publication of the npm package name;
- removal of every internal endpoint, identifier, log, archive, and credential;
- the production deployment's privacy/security review.

The existence of this reference document is not authorization to publish institutional infrastructure details or brand assets.
