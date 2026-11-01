# SystemOne decision plugin

[简体中文](README.md) | **English**

`@eduwork/dsh-decision` adds the `decision_evaluate` tool and `decision` skill to DSH for classification, condition probabilities and rubric scoring. Use it for routing requests, checking supplied material or evaluating text. Model output does not trigger business actions.

Uses native DSH tools, skills and configuration, without runtime patches or desktop bridges. The user or distribution supplies the endpoint, model and authentication; no institution or inference service is configured by default.

## Installation and use

Source version 0.1.0 is prepared for its first npm publication. After publication, install `@eduwork/dsh-decision` with DSH plugin management. Its native bundle ID is `decision`, initially `enabled: false`. Configure and enable the plugin; its tool and skill share its lifecycle. Then ask, for example: “Use the decision model to classify this request as billing, technical or insufficient information.”

API-key example (store the actual key in the credential service):

```json
{
  "enabled": true,
  "baseURL": "https://decision.example.org/v1",
  "model": "your-decision-model",
  "authMode": "api-key",
  "credentialRef": "SYSTEMONE_API_KEY",
  "requestTimeoutMs": 60000,
  "maxQuestions": 32,
  "maxRequestBytes": 65536,
  "imageInput": "none"
}
```

`baseURL` includes the API prefix; the plugin appends only `/systemone`. HTTPS is required except for loopback HTTP tests. Tool arguments cannot change the endpoint or model.

For organization sign-in, select `authMode: "oidc"`, set `oidcProfileId`, and install a compatible `@eduwork/dsh-oidc` exposing the Host APIs `modelAuthorization` and `authorizedFetch`. The base URL must match its authorized model resource. OIDC owns renewal; failure never falls back to a personal key. Explicitly unauthenticated services may use `authMode: "none"`, which does not read credentials.

Disabled by default. Enabling it does not start probes or background polling; only tool calls contact the service. Logout, credential replacement and disposal invalidate corresponding pending requests. Redirects, automatic POST retries and model fallback are disabled. Timeout does not cancel upstream inference.

## Protocol coverage

Supports the basic [TypeSafe System One](https://docs.typesafe.ai/api/system-one) `model/state/questions` format and `choice/noul/score` responses. Extension response fields are preserved; full experimental API compatibility is not claimed.

- `state`: text, JSON object or array. Instructions and criteria may contain structured JSON; a service may require stricter formats such as nonempty strings.
- Noul remains a 0–1 probability; scores remain fractional values on a zero-based scale; null choices remain abstentions. Confidence definitions differ across services and are not converted to accuracy estimates.
- TypeSafe `assets/box`, StartLux thinking controls and other implementation extensions are outside the first version. Enable `imageInput: "data-uri"` only for services explicitly supporting an `images` Data URI array; only then is the tool parameter exposed.
- Client defaults: 32 questions, 64 KiB complete request, 512 KiB response. Configure the first two up to 512 questions and 16 MiB. Data URI mode permits up to 8 PNG/JPEG/WebP images; increase the complete-request limit for image requests. These bounds do not guarantee server capacity.
- Default timeout: 60 seconds, configurable from 1 to 195000 milliseconds. Errors expose status and guidance, not arbitrary response bodies or credentials.

## Development and assembly

Source lives in `src/`; building copies ESM modules, with no bundled third-party dependencies. Node >=24.22.1; tested baseline DSH 0.2.1-rc.3. Set `EDUWORK_DECISION_RUNTIME` to the locked Runtime directory containing package.json/node_modules, then run `npm ci` and `npm run check`. Tests use synthetic material and local HTTP.

Repository commands: `node scripts/packages/manage.mjs check dsh-decision` and `pack dsh-decision`; see [package maintenance](../../docs/PACKAGES_EN.md). Publish and verify npm bytes before changing exact product locks. This change does not insert unpublished source into existing desktop assemblies.
