# DSH integration and extension seams

[简体中文](dsh-integration.md) | **English**

## Supported host baseline

Current `0.2.0` uses the registry-published DSH `0.1.5-rc.1` development/CI closure. Historical stable `0.1.0` targets `0.1.2-rc.1`; older candidate evidence is recorded separately in the [compatibility matrix](compatibility.en.md). Never mix DSH lines. See [development preparation](development.en.md) for clean installation.

The plugin uses public package exports rather than copied DSH source:

| DSH service/package | Use |
| --- | --- |
| `dsh-typert-protocol` | Host/client RPC descriptors. |
| `dsh-host-webserver` | Exact `/oauth/callback` route. |
| `dsh-credentials` | Session and runtime API-key storage. |
| `dsh-llm` | Adapter registry, credentials, retry policy, stable errors. |
| `dsh-llm-pi-ai` | Official `PiAiAdapter`. |
| `dsh-settings` | Provider directory/readiness facts. |
| `dsh-launch-environment` | Credential fallback when no Credential Provider service is present. |
| client runtime/remotes/slots/theme | Browser bundle and bounded UI/brand surfaces. |

The OpenAI-compatible wire implementation comes from `@earendil-works/pi-ai`, which is already the basis of DSH's official Pi adapter.

## Why the Provider adapter is inside this package

OIDC authentication alone does not yield a callable enterprise model. A closed-loop integration also needs a stable Provider route whose credential reference matches Key Binding output. Publishing a second organization-specific Provider package would recreate the coupling this repository is meant to remove.

The adapter is therefore an internal module of `dsh-oidc`, but its behavior is constrained:

- one audited `openai-compatible` implementation;
- declarative Provider/model facts only;
- official DSH LLM registry and Pi adapter;
- no second HTTP stack;
- no ambient pi-ai credential discovery;
- DSH-owned retry policy and attachment resolution.

It remains exported as `@eduwork/dsh-oidc/provider` for tests and advanced local composition, but Enterprise Profiles cannot replace it.

## Cordis service entry

The default export is `OidcAccountService`, a `TypertRemoteService` named `oidcAccounts`. Remote methods are:

| Method | Result |
| --- | --- |
| `configuration()` | Public profiles with secrets and endpoint bases removed. |
| `openConfiguration(target)` | Host-backed configuration/example opening; no file contents or secrets returned. |
| `status(profileID)` | Local session/credential state. |
| `begin(profileID)` | Web redirect, temporary desktop login ID, or legacy native completion. |
| `loginStatus(loginID)` / `cancelLogin(loginID)` | Poll or cancel the current desktop attempt. |
| `resources(profileID)` | Model metadata and issues, without quota or secrets. |
| `selectEnterpriseModel(profileID, options)` | Select a verified connected model through official defaults; no arbitrary Provider destination. |
| `reconcile(profileID, {allowProvision})` | Bootstrap and resolve/provision/renew. |
| `logout(profileID)` | Local cleanup and best-effort OIDC revocation. |
| `management()` | Capability-aware projection consumed by the shared enterprise-model settings UI. |
| `activate/configure/addCustom/updateCustom/removeProfile/configureModels/restart` | Optional native management operations; Web profiles reject mutation. |

The client descriptor uses strict Zod codecs. Configuration sent to the browser excludes issuer, client ID, Key Binding base, model base URL, tokens, and keys.

## Web composition

### Direct installation

`dsh-oidc` declares its own default local-Web Bundle patch. Install it directly from npm into the official Web profile without authoring a wrapper Bundle:

Install exact `0.2.0` with a coherent DSH `0.1.5-rc.1` host. If the registry does not yet provide this version during release preparation, use the reviewed source/frozen artifact below.

```bash
dsh plugin --profile web add @eduwork/dsh-oidc@0.2.0
```

For auditing, development, or validating unpublished changes, install a reviewed local checkout instead:

```bash
git clone https://github.com/ecnu/EduWork.git
cd EduWork/packages/dsh-oidc
npm ci
npm run check
dsh plugin --profile web add .
```

The local-path install links the checkout into the Profile, so the source directory must remain available. It does not scan the current workspace. Team deployments should pin a reviewed, exact npm version and must not mix another DSH prerelease line into the same Profile.

The shipped patch mounts exactly one `enterprise-oidc` instance using `EDUWORK_OIDC_PROFILE`. The Web backend requires the DSH WebServer to listen exactly on `127.0.0.1` and builds the fixed `/oauth/callback` from its actual port; no public callback-origin setting is accepted. The patch does not hard-code `agent-default-model`; after explicit login/key binding, the Client selects the connected organization model through official APIs. Restart recovery only repairs an unusable default and preserves personal selections. `DSH_OIDC_ENTERPRISE_PROFILE` remains a fallback.

### Product-owned Bundle

```yaml
- id: agent-default-model
  config:
    provider: example-ai
    model: example-max

- insert:
    - id: enterprise-oidc
      name: '@eduwork/dsh-oidc'
      config:
        profilePathEnv: EDUWORK_OIDC_PROFILE
        web:
          returnPath: /
```

The containing DSH profile/bundle must also include the ordinary Web app, credentials, LLM/Pi adapter dependencies, settings, attachment services, and client surfaces. `dsh-oidc` is not a complete DSH distribution.

See the [getting-started guide](getting-started.en.md) for OIDC registration, Key Binding implementation, environment variables, acceptance, and troubleshooting.

## Desktop composition

New Wails/Electron products use `backend: desktop`: the plugin owns a temporary loopback callback and opens the browser through official `nativeCommand`. Both shells share identity, Key Binding and model behavior. The host still provides credential storage; no new `enterpriseAccounts` bridge is required. See [desktop host integration](desktop-host.en.md).

## Legacy native bridge

The following adapter interface is only for existing integrations. It is not required for a new desktop:

```yaml
- insert:
    - id: enterprise-oidc
      name: '@eduwork/dsh-oidc'
      config:
        backend: native
        uiMode: models-only
        profilePathEnv: PRODUCT_ENTERPRISE_PROFILE
```

The host supplies Cordis service `enterpriseAccounts`. Any product-owned institution catalog MUST first be converted by the host or assembly layer into a standard Enterprise Profile; `dsh-oidc` does not read or interpret product catalogs:

```ts
interface EnterpriseAccounts {
  status(institutionID: string): Promise<NativeStatus>
  login(institutionID: string, options: { allowProvision: false }): Promise<NativeStatus>
  reconcile(institutionID: string, options: { allowProvision: boolean }): Promise<NativeStatus>
  logout(institutionID: string): Promise<NativeStatus>
  configuration(): Promise<NativeManagement>
  activate(institutionID: string): Promise<NativeManagement>
  configure(institutionID: string): Promise<NativeManagement>
  addCustom(baseURL: string): Promise<NativeManagement>
  updateCustom(institutionID: string, baseURL: string): Promise<NativeManagement>
  removeInstitution(institutionID: string): Promise<NativeManagement>
  configureCustomModels(institutionID: string, mode: 'discovery' | 'manual', models: RuntimeModel[]): Promise<NativeManagement>
  restart(): Promise<{restarting: true}>
}
```

`NativeStatus` may include `displayName`, `organization`, `state`, `userName`, `affiliation`, `accessExpiresAt`, `runtimeCredentialRef`, `credentialReady`, `credentialState`, and `capabilities`. `runtimeCredentialRef` is only a host status assertion; when present, it MUST equal the normalized Enterprise Profile `keyBinding.credentialRef`. Credential naming belongs to the Profile, not to Wails, Electron, or any other host implementation.

Only the first four lifecycle operations are required for a native identity backend. Management operations are capability-detected: when absent, the same UI remains a read-only profile/model viewer. This is a host adapter, not part of OIDC or Key Binding wire standards. It can be implemented by Wails, Electron, Tauri, a mobile bridge, or another local host.

The public browser projection is versioned as `dsh-oidc/management/v1alpha1`. It deliberately excludes tokens and credentials. Web Enterprise Profiles set all mutation capabilities to false; a native adapter may set `manageProfiles`, `manageModels`, and `restart` according to the methods it actually provides.

## Model capability transforms

The plugin exposes a Cordis service named `enterpriseTransforms`:

```js
const dispose = ctx.enterpriseTransforms.register({
  provider: 'example-ai',
  model: 'example-max',
  inputModalities: ['image'],
  when: ({ inputModalities }) => !inputModalities.includes('image'),
  transform: async (request, nativeModelInfo) => {
    // Return a provider-bound request. Do not mutate request/transcript in place.
    return request
  },
})
```

Route-wide and model-specific transforms run in that order. Duplicate registrations at the same scope are rejected. Registration changes emit `llm/adapters-updated`.

Transforms are executable local plugins and must be reviewed separately. They are never loaded from an Enterprise Profile.

## DSH upgrade procedure

For every DSH release candidate or stable upgrade:

1. update exact peer versions in a branch;
2. diff the public exports and relevant types used above;
3. run unit and package tests;
4. launch a plain Web DSH profile and complete login, provisioning, model call, refresh, logout;
5. launch the desktop/native composition and compare user-visible behavior;
6. verify client loader format and slot names;
7. review whether official DSH capability supersedes any local adapter code;
8. record results in `docs/compatibility.en.md` before release.

No semver range should silently opt this security-sensitive plugin into an untested DSH release while DSH remains pre-1.0.

## Credential reads for institution adapters

Explicitly installed local adapters may call `ctx.oidcAccounts.resolveBoundCredential(profileID, { credentialRef: "EDUWORK_API_KEY", runtimeBaseURL })`. The runtime URL must exactly match the reviewed Profile model-service URL. The result is a DSH credential record verified against the session, issuer/client ID, complete resource binding and credential fingerprint, or `undefined`. Use this same snapshot rather than checking status and resolving the name separately, which can race with a login change. This is Host-only, with no Typert/RPC registration and no addition to the server protocol. Adapters remain responsible for restricting request destinations. Desktop/Web support the method; the legacy native bridge does not fall back to an unverified key.
