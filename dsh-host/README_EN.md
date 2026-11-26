# Shared desktop Host

[简体中文](README.md)

This directory adapts the pinned DSH `0.1.5-rc.2` desktop Host for Electron as a local, single-user Host.

Prepare the shared adapter with Node 24:

```powershell
node dsh-host/prepare.mjs --upstream <verified-source-directory> --output <candidate-host-directory>
```

The preparer checks every imported source file against its fixed SHA-256. It uses
Node's TypeScript transformer without installing Electron or a compiler. The output
includes `host-process.mjs`, `host-protocol.mjs`, a `desktop-host` package overlay,
the upstream MIT license, and a receipt with source and output hashes. Install the
overlay at the product profile's `node_modules/@deepseek-ai/dsh-desktop-host`.
Keep `lib/wire.js` with `lib/index.js`; this adapter deliberately does not bundle
unrelated Electron application code.

The source changes are narrowly scoped:

- Preserve agent preset roots supplied by the product profile. Use the official
  preset root only when the selected composition supplies no roots.
- Accept `allowLinkedProfile: true` explicitly for an isolated local development build;
  this does not open a Node inspector. The default retains official path checks.
- Pass the optional desktop bootstrap through one stdin JSON line. Credentials do
  not appear in arguments, environment variables, receipts, or browser state.
- Redirect Host logs to stderr so bridge stdout remains binary, bound the retained
  stderr tail, and report lifecycle failure to the owner.
- Keep pipe descriptors owned by their Node streams during shutdown. Calling
  `closeSync` after `destroy()` races pending Windows I/O and can close an fd twice;
  the derived Host removes those two manual closes. Source hashes remain pinned.

Electron can import the generated `DesktopHostProcess` directly:

```js
const host = new DesktopHostProcess(nodePath, profilePath, undefined, {
  bootstrap, allowLinkedProfile: true, onFailure,
})
await host.start()
const response = await host.fetch(request)
await host.stop()
```

## Validation

```powershell
$env:DSH_HOST_SOURCE = '<verified-source-directory>'
$env:EDUWORK_TEST_RUNTIME = '<pinned-legacy-runtime-directory>'
node --test dsh-host/test/prepare.test.mjs
```

Product profiles, sign-in, previews and native windows require separate acceptance
on assembled candidates. Generated adapters, logs, profiles and user credentials
belong in ignored build directories.
