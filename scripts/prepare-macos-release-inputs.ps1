#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Product, [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if (-not $IsMacOS -or (& node -p 'process.arch').Trim() -ne 'arm64') { throw 'macOS inputs require an arm64 runner' }
$core = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Output = [IO.Path]::GetFullPath($Output)
$Product = [IO.Path]::GetFullPath($Product)
if ((Test-Path $Output) -or (Test-Path (Join-Path $Product 'r')) -or (Test-Path (Join-Path $Product 'desktop-resources.json'))) { throw 'Use new input and product resource directories' }
New-Item -ItemType Directory -Path $Output | Out-Null
$lock = Get-Content (Join-Path $core 'config/macos-native.lock.json') -Raw | ConvertFrom-Json -AsHashtable
$python = Get-Content (Join-Path $core 'dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json') -Raw | ConvertFrom-Json -AsHashtable
$nodeLock = Get-Content (Join-Path $core 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json') -Raw | ConvertFrom-Json -AsHashtable
if ($lock.platform -ne 'darwin-arm64' -or $lock.browser.version -ne $nodeLock.environment.browserAutomation.browserVersion) { throw 'macOS native lock does not match the qualified runtime' }
function Download([object]$Asset, [string]$Name) {
    if ($Asset.url -notmatch '^https://' -or $Asset.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Downloads require HTTPS and a pinned SHA-256' }
    $file = Join-Path $Output $Name
    Invoke-WebRequest -Uri $Asset.url -OutFile $file -MaximumRetryCount 3 -RetryIntervalSec 5
    if ((Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Asset.sha256) { throw "Native input hash mismatch: $Name" }
    return $file
}
function Extract([string]$Archive, [string]$Directory) {
    New-Item -ItemType Directory -Path $Directory | Out-Null
    & tar -xf $Archive -C $Directory --strip-components 1
}
$nodeAsset = $nodeLock.assets['darwin-arm64']
Extract (Download $nodeAsset 'node.tar.gz') (Join-Path $Output 'node')
$node = Join-Path $Output 'node/bin/node'
$resources = Join-Path $Product 'r'
New-Item -ItemType Directory -Path $resources | Out-Null
Extract (Download $python.assets['darwin-arm64'] 'python.tar.gz') (Join-Path $resources 'p')
$pythonExe = Join-Path $resources 'p/bin/python3'
$wheels = @()
foreach ($package in $python.environment.packages) {
    $asset = if ($package.assets.ContainsKey('darwin-arm64')) { $package.assets['darwin-arm64'] } else { $package.assets.any }
    $name = [Uri]::UnescapeDataString(([Uri]$asset.url).Segments[-1])
    $wheels += Download $asset $name
}
& $pythonExe -I -B -m ensurepip --upgrade
& $pythonExe -I -B -m pip install --no-index --no-deps --no-compile --no-cache-dir --disable-pip-version-check @wheels
# Prevent library imports from creating __pycache__ in the signed application.
$pythonLauncher = '#!/bin/sh' + "`n" + 'exec "$(dirname "$0")/p/bin/python3" -B "$@"' + "`n"
[IO.File]::WriteAllText((Join-Path $resources 'office-python'), $pythonLauncher)
& chmod 755 (Join-Path $resources 'office-python')

$browserArchive = Download $lock.browser 'chromium.zip'
New-Item -ItemType Directory -Path (Join-Path $Output 'browser') | Out-Null
& ditto -x -k $browserArchive (Join-Path $Output 'browser')
& mv (Join-Path $Output 'browser/chrome-mac-arm64') (Join-Path $resources 'b')
$browser = Join-Path $resources ('b/' + $lock.browser.executable)
if ((Get-FileHash $browser -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.browser.executableSHA256) { throw 'Chromium executable differs from its lock' }

Extract (Download $lock.openssl 'openssl.tar.gz') (Join-Path $Output 'openssl-source')
$openssl = Join-Path $Output 'openssl'
$env:MACOSX_DEPLOYMENT_TARGET = '15.0'
Push-Location (Join-Path $Output 'openssl-source')
try {
    & perl ./Configure darwin64-arm64-cc "--prefix=$openssl" --libdir=lib no-tests
    & make -j3
    & make install_sw
} finally { Pop-Location }

$catalogPath = Join-Path $Product 'd/node_modules/@eduwork/dsh-artifact-services/lib/transcription-components.js'
$catalog = (& $node --input-type=module -e 'import {pathToFileURL} from "node:url";const m=await import(pathToFileURL(process.argv[1]));console.log(JSON.stringify(m.getTranscriptionComponents()))' $catalogPath) | ConvertFrom-Json
if ($catalog.engine.version -ne $lock.whisper.version) { throw 'Whisper source differs from the shared speech protocol version' }
$model = @($catalog.models | Where-Object id -eq 'whisper-tiny-q5_1')
if ($model.Count -ne 1) { throw 'Expected one pinned multilingual transcription model' }
Extract (Download $lock.whisper 'whisper.tar.gz') (Join-Path $Output 'whisper-source')
& cmake -S (Join-Path $Output 'whisper-source') -B (Join-Path $Output 'whisper-build') -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=OFF -DGGML_BLAS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_CURL=OFF
& cmake --build (Join-Path $Output 'whisper-build') --config Release --target whisper-cli --parallel 3
New-Item -ItemType Directory -Path (Join-Path $resources 'a') | Out-Null
Copy-Item (Join-Path $Output 'whisper-build/bin/whisper-cli') (Join-Path $resources 'a/whisper-cli')
Copy-Item (Download $model[0] 'model.bin') (Join-Path $resources 'a/model.bin')
New-Item -ItemType Directory -Path (Join-Path $resources 'licenses') | Out-Null
Copy-Item (Join-Path $Output 'whisper-source/LICENSE') (Join-Path $resources 'licenses/LICENSE-whisper.cpp')
Copy-Item (Join-Path $Output 'openssl-source/LICENSE.txt') (Join-Path $resources 'licenses/LICENSE-OpenSSL')
Invoke-WebRequest 'https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE' -OutFile (Join-Path $resources 'licenses/LICENSE-whisper-model') -MaximumRetryCount 3
$manifest = @{
    schemaVersion=1;platform='darwin-arm64'
    python=@{baseRoot='r/p';executable='r/p/bin/python3';version=$python.pythonVersion;runtimeId=$python.runtimeId;archiveSHA256=$python.assets['darwin-arm64'].sha256}
    environment=@{DSH_OFFICE_PYTHON='r/office-python';DSH_MEDIA_BROWSER=('r/b/'+$lock.browser.executable);DSH_MEDIA_NODE_ENV='d'}
    browser=@{version=$lock.browser.version;executableSHA256=$lock.browser.executableSHA256}
    pluginConfig=@{'eduwork-artifact-services'=@{transcription=@{local=@{executablePath='r/a/whisper-cli';modelPath='r/a/model.bin'}}}}
}
$manifest | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $Product 'desktop-resources.json') -Encoding utf8NoBOM
@{schemaVersion=1;node=$node;openssl=$openssl;platform='darwin-arm64';nativeLockSHA256=(Get-FileHash (Join-Path $core 'config/macos-native.lock.json') -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json | Set-Content (Join-Path $Output 'inputs.json') -Encoding utf8NoBOM
