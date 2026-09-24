# Independent configuration and Skills updates

[中文](CONTENT_UPDATES.md) · [Software updates](UPDATES.md) · [Distribution assembly](BUILD.md)

Electron can download small publisher-signed content bundles for organization model catalogs, feature switches, media configuration and official Skills. Generic EduWork does not enable remote content management by default. Administrators explicitly configure the source, public key and permitted components.

## User experience

The existing update area in Settings checks both software and content. Software retains its application version and installation progress. The content section shows separate configuration and Skills revisions, download progress and activation status. The existing small blue sidebar button opens this shared panel.

Content can be downloaded separately. Downloading available software also starts a compatible content download when one is available. Work can continue after download; content activates on the next launch, or through the explicit restart button. Finish running tasks before restarting. Both mechanisms share the stable/development preference; changing channels never downgrades installed content. Missing dependencies require a compatible software update rather than automatic dependency installation.

## Ownership and scope

- Configuration may update `organizations`, `features` and `media` only. Signed defaults merge into the editable file; locally modified fields and custom entries are retained.
- Skills bundles contain a complete publisher Skills snapshot, including references and auxiliary scripts using existing runtimes.
- Program files, plugins, npm packages, Python, Node and browsers remain whole-application updates. Content cannot carry executable binaries or runtime directories.
- Personal/workspace Skills, user models, credentials, conversations and desktop preferences are preserved. Locally modified bundled Skills prevent online replacement and should be saved as personal Skills first.

Configuration updates write the single active `config/eduwork.jsonc`, retaining one `data/configuration/eduwork.previous.jsonc` backup. Untouched defaults update while local edits, additions and deletions survive; conflicts are shown in Settings. Remote content cannot change sources, public keys, product branding or desktop preferences. See [configuration](CONFIGURATION_EN.md).

## Source configuration

Add to the base `config/eduwork.jsonc`; replace the public-key placeholder before deployment:

```json
"contentUpdates": {
  "publisher": "example",
  "baseURL": "https://downloads.example.org/eduwork/content",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n<Ed25519 SPKI public key>\n-----END PUBLIC KEY-----\n",
  "configuration": true,
  "skills": true,
  "bundled": { "configuration": 1, "skills": 0 }
}
```

Both permission flags default to false. `bundled` records component revisions included in the software package; omitted values or zero mean unversioned built-in content. Increase these revisions when a future full package incorporates newer content so an old cache cannot override it. Never change published bytes under the same revision.

Keep the Ed25519 private signing key outside Git, CI artifacts, client packages and uploaded folders. The client carries only the public key. Change the key or source through base configuration/software distribution, never through a content update. Institution editions can [download signed configuration on first launch](PUBLISHER_BOOTSTRAP_EN.md) and distribute CI artifacts unchanged. Local assembly remains available for static configuration deployments.

For example, run `openssl genpkey -algorithm ED25519 -out content-signing.pem`, then `openssl pkey -in content-signing.pem -pubout -out content-public.pem`. Use a private directory outside the repository and restrict private-key access to the publisher account.

## Dependencies and release plan

Software follows SemVer; content uses positive integer revisions. A publisher uses one increasing release sequence across both channels, plus an increasing revision for each changed component. Include unchanged components with their original bytes and revision. Each Skill must declare dependencies in the release plan and have a matching `<name>/SKILL.md` entry.

Requirements include mandatory `minClient` and `capabilities`, optional `maxClientExclusive`, and an optional exact `dsh` version. The bundle requirements must cover every Skill; an individual upper client bound must match the bundle bound. Installed capability names come from `resources/product/assembly.json`: `package:<name>` for `managedPackages` and `plugin:<name>` for `localPlugins`. Presence does not prove account/model availability. Use client version bounds for required tool API versions; dependencies are never installed by this mechanism.

Use optional `platforms` with `win32`, `darwin` or `linux` for platform-specific scripts. Omission means all platforms and requires publisher validation. Current desktop release acceptance covers Windows; a declaration does not certify the product on another platform.

Save a private release plan, with paths relative to the plan file:

```json
{
  "channel": "development",
  "revision": 2,
  "requires": {
    "minClient": "0.3.6-dev.20260916.1",
    "dsh": "0.1.5-rc.2",
    "capabilities": ["package:@eduwork/dsh-oidc"]
  },
  "configuration": { "revision": 2, "path": "configuration.json" },
  "skills": {
    "revision": 1,
    "path": "official-skills",
    "entries": [{
      "name": "example",
      "requires": {
        "minClient": "0.3.6-dev.20260916.1",
        "dsh": "0.1.5-rc.2",
        "capabilities": []
      }
    }]
  }
}
```

A source authorized for only one component includes only that component. A source managing both must always include both, preserving unchanged bytes and revisions. The configuration patch is plain JSON, for example `{"features":{"visionFallback":true}}`. The Skills directory is the complete official snapshot and must not contain personal Skills. Auxiliary scripts do not run installation hooks, npm or pip.

## Building and publishing content

With Node 24, run from the source root:

```powershell
node scripts/create-content-update.mjs --config /private/eduwork.jsonc --plan /private/plan.json --key /private/content-signing.pem --output /private/new-content-output
```

The output directory must not exist. The script validates the signing key, configuration, paths and dependencies, then generates files without uploading:

```text
new-content-output/
  bundles/content-2-<sha256>.json
  development/latest.json
  receipt.json
```

Test downloading, restart activation and rollback in an isolated client first. Upload immutable bundle files before the channel's `latest.json`. For stable content, sign separate stable and development manifests referencing the same bundle so development users receive stable content too. Revisions must remain monotonic across channels.

Manifest URL: `<baseURL>/<stable|development>/latest.json`. Bundles must remain under the same HTTPS origin and base path. Redirects, login cookies, URL credentials and temporary signed download URLs are unsupported. Disable caching for `latest.json`; immutable hash-named bundles can be cached long-term. Removing a manifest stops downloads, not already-applied content.

The `schemaVersion: 1` envelope contains base64url JSON `payload` and an Ed25519 `signature`. The signed payload binds publisher, channel, release revision, requirements, component revisions and bundle URL/size/SHA-256. Bundles are JSON; each Skill file has a relative path, size, SHA-256 and base64 bytes. The total limit is 16 MiB. Validation rejects path traversal, duplicate files, symlinks, undeclared Skill entries and executable binaries.

## Recovery and diagnostics

Downloads stage under `data/content-updates/` without changing application files. Failed downloads can be retried after checking again; small content bundles are downloaded afresh. The journal distinguishes file application from desktop startup, and only successful desktop loading commits the trial. Failed or interrupted startup restores the previous usable content and the single configuration backup while preserving local edits.

Local permission, file-lock or disk-space errors, and file transactions interrupted before desktop startup, leave the same signed content retryable after the local problem is fixed. Genuine startup failures still stop automatic retries; publishers must use a higher revision for changed content. An explicit update check, startup retry or signed offline import from the startup window can revalidate and retry the exact failed bundle at the highest received revision, including legacy rejection records. Background checks do not authorize this recovery. Signature, channel, dependency, component revision and anti-rollback checks remain mandatory; older revisions and different bundles at the same revision stay blocked.

Startup also checks bundled revisions and client/DSH compatibility. An unavailable content server does not prevent startup. The diagnostic ZIP includes software/content states, revisions and errors, without private keys, credentials or full content bundles. Existing clients must first receive software that implements this mechanism; legacy Go clients retain their whole-package upgrade path.
