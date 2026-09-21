# LiteLLM setup guide

[简体中文](litellm-setup.md) | **English**

Let users sign in to a LiteLLM gateway from EduWork, discover authorized models, and chat without manually distributing model API keys.

[LiteLLM](https://github.com/BerriAI/litellm) provides the gateway; EduWork uses its native OAuth flow. This guide is for administrators of an existing LiteLLM deployment and EduWork desktop users. The protocol baseline is **LiteLLM v1.101.0 / native contract 1**; validate other versions using the checks below. **EduWork 0.3.6-dev.20260921.1 includes this feature** and a commented `examples/litellm.jsonc`; no additional plugin installation is needed. The underlying implementation is published as `@eduwork/dsh-oidc@0.3.0-dev.2`.

## 1. Prepare the server

Follow the [official LiteLLM deployment guide](https://docs.litellm.ai/docs/proxy/quick_start) to prepare a gateway, database, and at least one working real model upstream. Configure a test user's account, teams, and model permissions, and verify browser sign-in. Enterprise SSO deployment and licensing requirements are governed by LiteLLM; this guide does not require a new identity provider.

Set these environment variables on the existing LiteLLM Proxy process or container, replacing the example with the public HTTPS address users reach, then restart it:

```dotenv
PROXY_BASE_URL=https://gateway.example.org
EXPERIMENTAL_UI_LOGIN=True
```

`PROXY_BASE_URL` sets the public issuer and endpoints; do not advertise an internal reverse-proxy address. `EXPERIMENTAL_UI_LOGIN` enables the required login feature. See [LiteLLM CLI Authentication](https://docs.litellm.ai/docs/proxy/cli_sso).

Forward discovery, authorization, registration, token, revocation, and model routes through the proxy. Preserve query parameters and form bodies, allow streaming SSE, and avoid redirects of authentication POSTs to another origin. Multiple workers or replicas need shared Redis, for example through `general_settings.coordination_redis`, so refresh rotation and revocation are not limited to one process. See the [configuration reference](https://docs.litellm.ai/docs/proxy/config_settings) and [native authentication implementation](https://github.com/BerriAI/litellm/blob/v1.101.0/litellm/proxy/_experimental/mcp_server/discoverable_endpoints.py).

From the user's network, check public discovery without credentials:

```sh
curl --fail --silent --show-error https://gateway.example.org/.well-known/litellm-cli-auth
```

The JSON response must satisfy:

- `contract_version` is `1`; `issuer` and `resource` are the configured public gateway address.
- It includes `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, and `revocation_endpoint`.
- It advertises authorization codes, refresh, PKCE `S256`, and public-client authentication with `none`.

See the [protocol reference](README_EN.md) for the full response and constraints. EduWork rejects missing capabilities or inconsistent endpoint bindings; a reachable login page alone does not establish compatibility.

## 2. Configure EduWork

Select **Open configuration file** in Settings. Add the object inside the example's `organizations` array to the same array in the active `eduwork.jsonc`. On Windows, it is in the application's `config/`; on macOS public editions, it is in `~/Library/Application Support/eduwork-electron/config/`. The adjacent `examples/litellm.jsonc` provides the same format and full comments. Editing only the example has no effect; do not replace existing settings with the entire example.

```json
{
  "schemaVersion": 1,
  "organizations": [
    {
      "schemaVersion": "dsh-oidc/v1alpha1",
      "id": "example-gateway",
      "displayName": "Example model gateway",
      "allowInsecureDevelopment": false,
      "auth": {
        "discoveryUrl": "https://gateway.example.org/.well-known/litellm-cli-auth",
        "expectedIssuer": "https://gateway.example.org"
      }
    }
  ]
}
```

| Field | Value |
| --- | --- |
| `id` | A stable organization identifier, unique on this client. |
| `displayName` | The organization name shown in the account menu. |
| `allowInsecureDevelopment` | Defaults to `false` for HTTPS only; set `true` for HTTP testing, beside `auth`. |
| `auth.discoveryUrl` | The complete discovery document URL supplied by the administrator. |
| `auth.expectedIssuer` | The expected issuer; recommended, and must match discovery. |

Save, exit completely through the tray or application menu, and restart EduWork. Closing its window usually leaves the process running.

The model API base is the validated issuer with `/v1` appended, preserving any deployment prefix. Do not set `provider.baseURL`. LiteLLM dynamically registers a Client ID for this login: do not configure a static `clientId`, `client_secret`, or scope, or combine this profile with `oidc` or `keyBinding`.

`allowInsecureDevelopment` is the only HTTP switch, at the profile root beside `auth`/`oidc`. Its default is `false` (HTTPS only); `true` also accepts HTTP service URLs. `insecureDevelopmentOrigin` is obsolete and ignored. Issuer identity, resource-origin validation and OAuth/PKCE checks still apply. `discoveryUrl` is the complete discovery URL; `expectedIssuer` is optional and pins the exact issuer when provided.

Developers integrating another client can use the [single Profile example](../../examples/litellm.enterprise-profile.example.json) and [desktop Host guide](../desktop-host.en.md) to reuse the same authorization and model modules. Desktop users do not need to assemble a Host themselves.

## 3. Sign in and use models

1. Select the configured organization in EduWork's account menu and start sign-in. Keep the client running.
2. Complete sign-in in the system browser. If the gateway asks for a team, select one with the required model permissions and approve access.
3. The browser returns to a local callback page. Once it confirms completion, return to EduWork.
4. Select an organization model and send a short message to verify a real upstream response.

![Selecting deepseek-v4-flash in the organization group after signing in to LiteLLM from EduWork](../../../../docs/images/litellm-models.png)

The local LiteLLM group is the configured organization name, and `deepseek-v4-flash` is an authorized gateway model. Server permissions determine your model list; the DeepSeek group above belongs to a separately configured provider.

The `127.0.0.1` callback is a temporary EduWork listener on the user's computer, not the LiteLLM server. Complete sign-in in a browser on the same computer as the client. Do not bookmark or reuse an old authorization link.

The client discovers the current authorization's `/v1/models`, sends requests with the Access Token, and refreshes near expiry. Protected local storage restores authorization after restart. Logout clears the local session and attempts Refresh Token revocation; the server controls the remaining lifetime of issued Access Tokens.

LiteLLM user and team settings continue to govern model authorization and billing; client configuration cannot grant permissions. This integration does not provide a unified quota panel. Model capabilities come from the catalog and administrator-reviewed configuration. ID-only catalogs default to text models without inferring image or reasoning support from names. See [Profile configuration](../enterprise-profile.en.md) for capability supplements.

## 4. Validate before rollout

Use a regular account for these checks. An administrator account, model listing, or mock response cannot substitute for actual inference:

| Check | Expected result |
| --- | --- |
| Sign-in, denied consent, and new sign-in | Success or denial is explicit; an old callback cannot finish a new login. |
| Catalog and real conversation | Only authorized models appear and a real upstream returns content. |
| Streaming | Actual conversation content arrives incrementally and ends normally; the proxy does not buffer the entire SSE. |
| Refresh during use and restart | Requests work after token refresh and sign-in survives restart, without copying Tokens. |
| User / team isolation | A restricted user cannot list or invoke unauthorized models. |
| Logout | New organization model requests are unavailable locally and the revoked Refresh Token cannot restore authorization. |

A test deployment can shorten token lifetime to exercise refresh. If test tooling simulates near-expiry, record that method. Successful sign-in alone does not validate refresh; a real gateway with a mock upstream does not validate real model inference.

## 5. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Discovery returns 404 or HTML | Check the LiteLLM version, public route, and reverse proxy; expect native contract 1 JSON. |
| Issuer / endpoint validation fails | Check `PROXY_BASE_URL`, public HTTPS addresses, and `expectedIssuer`; correct deployment settings and sign in again. |
| Browser reports connection refused at `127.0.0.1` | Keep EduWork running, use a browser on the same computer, and start a new sign-in from its account menu. |
| Sign-in works but the catalog is empty or inference returns 403 | Check the user, selected team, and model permissions; sign-in does not authorize every model. |
| Exchange / refresh fails or a request returns 401 | Check token expiry, gateway account status, and server logs; replicas need shared Redis for rotation and revocation. |
| A reasoning level or input type is unsupported | Follow the current catalog's capabilities; do not force unsupported `reasoningEffort` values or attachments. |
| Streamed content arrives all at once | Check reverse-proxy SSE buffering and connection timeouts. |

When reporting problems, include versions, the failing stage, HTTP status, and redacted errors. Exclude authorization codes, Tokens, and full callback URLs. See the [gateway protocol reference](README_EN.md) for detailed wire fields.
