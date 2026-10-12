# Assemble the relay deploy tree.
#
# The relay is built by whoever operates it, from `src/relay/` in the plugin
# package; the package does not ship a runnable server, and `docs/protocol.md` says
# so. This script is that build, kept out of `src/` so the plugin's own build stays
# a plain copy.
#
# The layout it produces is what `deploy/server.mjs` imports against, and getting
# it wrong is silent until the service refuses to start:
#
#   <out>/server.mjs     <- deploy/server.mjs
#   <out>/relay.js       <- src/relay/relay.js       } imported as './relay.js',
#   <out>/protocol.js    <- src/relay/protocol.js    } './protocol.js' and
#   <out>/websocket.js   <- src/relay/websocket.js   } './websocket.js'
#   <out>/web/           <- -BootstrapPath, as web/bootstrap.js, served by the relay
#   <out>/frontend/      <- -FrontendRoot, the built DSH web frontend
#
# Both inputs are required and neither is guessed:
#
#   * The bootstrap is deployment-specific, so it comes from the deployment. The
#     relay ships a placeholder that only prints a warning — see
#     `deploy/web/bootstrap.js` — and this refuses to assemble that placeholder by
#     accident.
#   * The frontend must be the build the Host actually runs. Taking "some dist"
#     would produce a page whose asset names do not match the ones the Host's own
#     browser loaded.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$FrontendRoot,
  [Parameter(Mandatory = $true)][string]$BootstrapPath,
  [string]$Output = "$PSScriptRoot\..\dist\relay"
)

$ErrorActionPreference = 'Stop'
$package = (Resolve-Path "$PSScriptRoot\..").Path
$output = [System.IO.Path]::GetFullPath($Output)
$placeholder = (Resolve-Path (Join-Path $package 'deploy\web\bootstrap.js')).Path

if (-not (Test-Path $FrontendRoot)) { throw "frontend root does not exist: $FrontendRoot" }
if (-not (Test-Path (Join-Path $FrontendRoot 'index.html'))) {
  throw "frontend root has no index.html, so the relay would serve 404 for every page: $FrontendRoot"
}
if (-not (Test-Path $BootstrapPath)) { throw "bootstrap does not exist: $BootstrapPath" }
if ((Resolve-Path $BootstrapPath).Path -eq $placeholder) {
  throw "that is the package's placeholder bootstrap; pass the deployment's build instead"
}
$bootstrapText = Get-Content $BootstrapPath -Raw
if ($bootstrapText -match 'replace web/bootstrap\.js with your deployment') {
  throw "the bootstrap given is a placeholder copy, not a real build: $BootstrapPath"
}
# A module script would be deferred, and the application reads the transport at
# import time. Catching it here beats debugging a page that loads and never connects.
if ($bootstrapText -match '(?m)^\s*(import|export)\s') {
  throw "the bootstrap looks like an ES module; it must be a classic script: $BootstrapPath"
}

if (Test-Path $output) { Remove-Item $output -Recurse -Force }
New-Item -ItemType Directory -Path $output -Force | Out-Null

Copy-Item (Join-Path $package 'deploy\server.mjs') $output
foreach ($name in 'relay.js', 'protocol.js', 'websocket.js') {
  Copy-Item (Join-Path $package "src\relay\$name") $output
}
New-Item -ItemType Directory -Path (Join-Path $output 'web') -Force | Out-Null
Copy-Item $BootstrapPath (Join-Path $output 'web\bootstrap.js')
Copy-Item $FrontendRoot (Join-Path $output 'frontend') -Recurse

# The bootstrap must be reachable at the path the index injection names, and that
# path is a string constant in server.mjs. Check rather than assume.
$server = Get-Content (Join-Path $output 'server.mjs') -Raw
if ($server -notmatch "bootstrapScript:\s*'/eduwork-assets/bootstrap\.js'") {
  throw "server.mjs no longer names /eduwork-assets/bootstrap.js; the copy above may be at the wrong path"
}

$bootstrapBytes = (Get-Item (Join-Path $output 'web\bootstrap.js')).Length
$frontendFiles = (Get-ChildItem (Join-Path $output 'frontend') -Recurse -File).Count
Write-Output "assembled $output"
Write-Output "  bootstrap  $bootstrapBytes bytes from $BootstrapPath"
Write-Output "  frontend   $frontendFiles files from $FrontendRoot"
Get-ChildItem $output -File | ForEach-Object { "  " + $_.Name }
