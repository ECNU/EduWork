# Desktop hosts without a persistent Web server

[简体中文](desktop-host.md)

`backend: desktop` uses a temporary loopback callback for desktop sign-in. OIDC validation, host credentials, token refresh, model discovery and authorizedFetch reuse shared code. Web and desktop are supported; the legacy native account bridge is removed.

```yaml
- id: enterprise-oidc
  name: '@eduwork/dsh-oidc'
  config:
    backend: desktop
    allowEmptyProfiles: true
    profilePathEnv: EDUWORK_OIDC_PROFILE
    desktop:
      callbackPort: 0
      flowTimeoutMs: 600000
```

The host supplies a Cordis `desktopServices` service with `openExternal(url: string): Promise<void>`. OIDC builds the authorization URL from reviewed Profile discovery; the renderer cannot submit an arbitrary URL. The shell opens the system browser, rejects non-HTTP(S) and userinfo URLs, and never logs authorization query parameters. The plugin does not execute shell commands or import Electron/Wails. The service can arrive later; removing it cancels pending sign-ins.

When the distribution provides `configFile: {path, examplesPath}`, organization settings stay read-only and are loaded again on restart. The optional Host method `openConfiguration(target: 'config' | 'examples'): Promise<void>` enables configuration-file and example-folder buttons. The RPC accepts these two fixed targets only; the host resolves its own paths, and the renderer cannot send a path or command. `configuration().configFile.canOpen` reports availability. Web hosts without this capability show the configuration-file location instead. Personal models and configured organization sign-in remain available.


The host must implement `credentials.resolve/set/unset`, backed by its operating-system vault. The plugin has no plaintext credential file or fallback on storage failure. OAuth tokens remain Host-only. Personal API keys remain independent of the organization's managed credential. The public `oidcAccounts.authorizedFetch()` capability remains Host-only.

Only an explicit sign-in starts an IPv4 `127.0.0.1` listener. The callback is `http://127.0.0.1:<port>/oauth/callback`, using a random port by default. Register a public PKCE client supporting dynamic loopback ports with the IdP. For providers requiring an exact registered URI, a trusted `callbackPort` can pin the port; a conflict fails explicitly instead of switching to an unregistered port. Other bind addresses are not configurable. Cancellation, expiry, success, a valid failed callback, service disposal and host shutdown close the listener. Invalid Host, Origin, state, method or path cannot consume the legitimate attempt.

Shared Host/Client RPC additions:

- `begin(profileID)` returns `{mode:'external', loginID, expiresAt}` for desktop. Existing Web `redirect` and legacy `completed` variants remain supported.
- `loginStatus(loginID)` returns `{loginID, profileID, state, expiresAt, status?, errorCode?}`. State is pending/completed/cancelled/expired/failed.
- `cancelLogin(loginID)` returns the same safe projection and waits for an in-flight credential write to roll back.
- `openConfiguration(target)` returns `{opened:true}` in file-managed mode; the only targets are `config` and `examples`. System-opening failures produce a concise message.
- `selectEnterpriseModel(profileID, {onlyIfMissing?})` returns `{changed, selection?}` on DSH 0.1.5 and persists the default through `agentDefaultModel.saveSelection()`.

Sign-in, sidebar and organization settings share one account snapshot. Credential Providers should emit the official `credentials/reference-updated` event after set/unset. The client listens to that forwarded Remote event and `connection/reset`; it does not depend on a custom account event that the official Remote transport does not forward.

Explicit sign-in with a connected model service selects the first resolvable enterprise model. A default is saved even when no session exists. For a current main session, the client also uses the official `modelDirectories.directoryFor(sessionID).select()` API; addressed subagents are left alone. Load the official `agentDefaultModel` and writable `settings` services. Older hosts without this capability show a message asking the user to choose from the model menu.

Initial upgrade recovery uses `onlyIfMissing:true`: it preserves an existing resolvable default and repairs only an absent or unavailable one. A valid personal selection in the current session is also preserved. Credential events, connection checks and subsequent status refreshes never select a model. Personal credentials and unrelated settings remain unchanged.

For desktop acceptance run `node scripts/serve-desktop-oidc-fixture.mjs --config <new test configuration file>`. It binds a random loopback port, serves synthetic HTTP PKCE/Token/models/quota and writes a public JSONC profile. The file must not exist; user configuration is never overwritten. Use isolated data directories for each shell and Ctrl+C to stop. No real accounts or model credits are used.

The independent random login handle is not OAuth state. Results never carry an authorization URL, code, nonce, verifier or token. The client polls once per second, displays browser completion instructions and a cancel button, and cancels on unmount. Sign-in expires within ten minutes. Closing a system browser cannot reliably be detected across platforms; the app cancel action and expiry bound the listener lifetime.

An empty Profile list is valid: no listener or organization login is needed. Identity-only profiles need no resource endpoints. Logout preserves personal keys. A resource outage after successful identity verification keeps the identity connected so resource access can be retried.

Run `node --test test/desktop.test.js test/desktop-host.test.js`. To test a frozen installation, set `DSH_OIDC_PACKAGE_ROOT` to its package directory and `DSH_OIDC_EXPECT_DSH=0.1.5-rc.1`. The latter test uses the installed package's actual Host dependencies without WebServer, optional browser-service lifecycle and HTTP PKCE. All credentials and identities are synthetic. Shell vault, window and system-browser integration still require product acceptance.

The `.20260910.6` public avatar menu provides account refresh and sign-out; quota UI requires an institution extension. A portal supports narrow sidebars; arrows, Home/End, Escape and outside click/focus are supported. Logout clears this profile's local identity, Tokens and cached model metadata, serializes vault writes and rejects late writes. Personal keys remain untouched.

The temporary HTTP callback page reads `brand.productName/organizationName/logoURL/mark/primaryColor` from this attempt's Profile and chooses Chinese or English from Accept-Language. It has no external fonts, scripts or raw error reflection and directs the user back to the app. Ordinary Web validation still redirects into its local app; model keys never enter the browser.

Run `npm run check` from an isolated dependency tree coherent with the exact target DSH. Do not relabel a bundle built using old root dependencies. `npm run check:browser` additionally uses that Runtime's `playwright-core` and locally installed headless Edge (or Chrome through `DSH_OIDC_BROWSER_CHANNEL`) to load the compiled client, verify menu/shared state/logout and capture branded callback pages. It does not replace native vault/system-browser acceptance.

## macOS integration requirements

The OIDC npm package is platform-independent JavaScript. It bundles no Electron, Wails, Keychain or Windows credential binary; macOS consumes the same exact version and integrity. The plugin has no platform branch: the Host interfaces above own shell differences. Windows validation does not establish macOS readiness.

Start with `npm ci` and `npm run check`. With Chrome installed, run `npm run check:browser` using `DSH_OIDC_BROWSER_CHANNEL=chrome`. The product owner must also validate a real macOS client:

- `desktopServices.openExternal` opens authorization in the system default browser; `openConfiguration` respects system file associations rather than forcing an editor.
- The Credential Provider stores, restores after restart, rotates and deletes credentials through system protection in the signed app. If the product uses Electron `safeStorage`, its Keychain behavior, unavailable encryption and denied access require main-process acceptance. The plugin never falls back to a plaintext file.
- Dynamic loopback ports, cancellation, timeout and app exit clean up correctly. The IdP registration cannot assume only the single port used in a Windows test.
- Login with and without an existing session updates shared account state and enterprise models. Restart preserves valid personal model selections.
- Validate the host, external browser and credentials separately on actual Apple Silicon and targeted Intel systems. Cross-OS history migration requires sign-in again; another machine's encrypted credential files are not portable credentials.

Signing, notarization, DMG/ZIP packaging and app/data-directory layout belong to the desktop distribution repository. This plugin adds no macOS-specific packaging branch.
