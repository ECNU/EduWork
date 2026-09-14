# Shared desktop Host

[简体中文](README.md)

This directory adapts the pinned DSH `0.1.5-rc.2` desktop Host for the Electron and Go/Wails shells. Both shells run a local, single-user Host.

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

Wails uses `dsh-desktop/internal/desktoptransport`. Windows Go `os/exec` does not
support `ExtraFiles`; the small `bridge.mjs` owns Node's required fd 3/fd 4 pipes
and fd 5 lifecycle IPC. The Go parent communicates with this bridge using stdin
and stdout. DSH's WebServer plugin is not loaded. The shell still has two private
loopback services: the authenticated native credential/browser bridge delivered
through bootstrap, and a read-only streaming carrier for Wails media/downloads.
Neither service is a shared-user application server.

Wails 2 on Windows buffers AssetServer responses until EOF. Finite static files
and RPC responses therefore have a 32 MiB defensive buffer limit. Indefinite
official event streams use `EventBridge.Open/Next/Cancel` native bindings instead.
Before serving each new top-level index, the shell advances a document generation
and cancels the preceding document's open/pending subscriptions. The generation
is injected into that page's event adapter, so a reload releases orphaned event
readers before even fetching the index, and stale JavaScript cannot reopen them.
GET/HEAD requests under `/api/` receive a 307 redirect to the media carrier, which
streams their response through the same Go/Node/official Host pipe without a
whole-file buffer. For files supporting byte ranges, the carrier first reads HEAD
metadata, then fetches at most 256 KiB from the official Host before writing each
block to the browser. A paused media element therefore does not occupy either
shared response pipe or prevent unrelated RPC responses. Native audio/video
elements, Range/HEAD requests and download anchors follow this redirect without
product-specific rendering code. Electron can apply the same bounded read
contract in its own runtime without importing Go or Wails code.

Each redirect has a random, exact-resource read capability valid for 30 minutes
and only for this process lifetime. Its URL is not an identity or bootstrap
credential and does not contain the original file query. It is never logged or
persisted. The carrier binds only `127.0.0.1`, validates Host and the Wails Origin
or Referer, exposes narrowly scoped CORS headers, rejects mutation methods and
changed queries, and clears capabilities on exit. ServiceWorker is not used:
WebView2 cannot load a worker through this Wails custom AssetServer.

The outer bridge retains DSH3's 13-byte frame header and raw 64 KiB body chunks.
Nonzero stream IDs use request/response start/data/end/cancel/error frames. A
response type 5 grants one upload chunk, preventing buffered uploads from blocking
cancellation. Stream 0 is reserved for bridge protocol 1: request 128 initializes
the private bootstrap, request 129 shuts down; response 128 reports ready, 129
reports fatal, and 130 reports stopped. These extra controls do not enter the
official Host wire. Go request contexts and response-body `Close` propagate cancel;
response streaming and Range headers pass through. A Windows Job Object contains
the bridge and Host, including abnormal parent termination.

The independent Wails entry is `dsh-desktop/cmd/eduwork-wails-candidate`. Its
default manifest is `eduwork.desktop.json` beside the executable; `--config` can
select another explicit manifest for development. Product, Node, Host and Data
paths are isolated, and an exclusive home lease is acquired before any profile
write or Host startup. It uses the
same `product-profile-cli.mjs` as the Electron profile helper, plus a separate
Windows Credential Manager namespace. `--probe` verifies the real official Host's
index and transport injection without opening a window. This is a candidate
entrypoint, not a replacement for `main.go` or the existing updater.

`dsh-desktop/scripts/assemble-official-host.ps1` assembles a new independent
candidate directory. Supply `-Product`, `-HostAdapter`, `-Output`, Node 24.18.0
with its adjacent `LICENSE`, and optional `-Version`. It retains the separate
product version and shell version in its receipt. It refuses existing output and
`current`. `build-official-host.ps1` supports rebuilding a closed candidate's
executable without recopying its complete runtime. The candidate uses a derived,
hash-checked go-webview2 source copy and an isolated Go modfile; production
`go.mod`, the module cache, and `main.go` are not changed. Diagnostic CDP is off
unless `EDUWORK_DESKTOP_CDP_PORT` is an explicit integer from 1024 to 65535; its
listener is restricted to loopback.

Validation:

```powershell
$env:DSH_HOST_SOURCE = '<verified-source-directory>'
node --test dsh-host/test/prepare.test.mjs
$env:DSH_HOST_ADAPTER = '<prepared-host-directory>'
cd dsh-desktop
go test ./internal/desktoptransport ./internal/nativevault -count=1
```

Protocol tests use the actual prepared official `DesktopHostProcess` and codecs
with a small fixture Host. They exercise a 9 MB binary upload/response, partial
media Range, native event pull, read capability boundaries, a response before
EOF, a paused 40 MiB read with a concurrent RPC, orphaned subscriptions followed
by page reload and new events, upload and response cancellation,
Host failure, stdin bootstrap and process
exit. They are distinct from the product profile, login, preview and
native-window acceptance tests performed on the assembled candidates. Generated
adapters, logs, profiles and user credentials belong in ignored candidate folders.
