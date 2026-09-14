#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Product, [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if (-not $IsWindows) { throw 'Windows x64 inputs require a Windows runner' }
$core = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Use a new input directory' }
New-Item -ItemType Directory -Path $Output | Out-Null
$python = Get-Content (Join-Path $core 'dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json') -Raw | ConvertFrom-Json -AsHashtable
$nodeLock = Get-Content (Join-Path $core 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json') -Raw | ConvertFrom-Json -AsHashtable
function Download([object]$Asset, [string]$Directory) {
    if ($Asset.url -notmatch '^https://' -or $Asset.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Downloads require HTTPS and a pinned SHA-256' }
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    $file = Join-Path $Directory ([Uri]::UnescapeDataString(([Uri]$Asset.url).Segments[-1]))
    Write-Host "Downloading $([IO.Path]::GetFileName($file))"
    Invoke-WebRequest -Uri $Asset.url -OutFile $file -MaximumRetryCount 3 -RetryIntervalSec 5
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Asset.sha256) { throw "Resource hash mismatch: $file" }
    return $file
}
function Extract([string]$Archive, [string]$Directory) {
    New-Item -ItemType Directory -Path $Directory | Out-Null
    & tar.exe -xf $Archive -C $Directory
}
$pythonArchive = Download $python.assets['windows-amd64'] (Join-Path $Output 'downloads')
$wheelRoot = Join-Path $Output 'wheels'
foreach ($package in $python.environment.packages) {
    $asset = if ($package.assets.ContainsKey('windows-amd64')) { $package.assets['windows-amd64'] } else { $package.assets.any }
    Download $asset $wheelRoot | Out-Null
}
$nodeAsset = $nodeLock.assets['windows-amd64']
$nodeArchive = Download $nodeAsset (Join-Path $Output 'downloads')
Extract $nodeArchive (Join-Path $Output 'node')
$node = Join-Path $Output "node/$($nodeAsset.archiveRoot)/node.exe"
# Browser resources have an independent qualified version. The npm Runtime's
# newer Playwright must not silently select a different Chromium revision.
$browserVersion = $nodeLock.environment.browserAutomation.browserVersion
if ($browserVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'Invalid locked Chromium version' }
$browserURL = "https://cdn.playwright.dev/builds/cft/$browserVersion/win64/chrome-win64.zip"
$browserAsset = $nodeLock.environment.browserAutomation.executables['windows-amd64'].archive
if ($browserAsset.url -ne $browserURL) { throw 'Browser archive URL differs from the qualified version' }
$browserArchive = Download $browserAsset (Join-Path $Output 'downloads')
$browserArchiveSHA256 = (Get-FileHash $browserArchive -Algorithm SHA256).Hash.ToLowerInvariant()
Extract $browserArchive (Join-Path $Output 'browsers')
$chromes = @(Get-ChildItem (Join-Path $Output 'browsers') -Recurse -File -Filter chrome.exe)
if ($chromes.Count -ne 1) { throw 'Expected one downloaded Chromium executable' }
if ((Get-FileHash $chromes[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $nodeLock.environment.browserAutomation.executables['windows-amd64'].sha256) { throw 'Chromium executable differs from the pinned resource' }
$catalogPath = Join-Path $Product 'd/node_modules/@eduwork/dsh-artifact-services/lib/transcription-components.js'
$catalog = (& $node --input-type=module -e 'import {pathToFileURL} from "node:url"; const m=await import(pathToFileURL(process.argv[1])); console.log(JSON.stringify(m.getTranscriptionComponents()))' $catalogPath) | ConvertFrom-Json
$asrAsset = @($catalog.engine.binaries | Where-Object { $_.platform -eq 'win32' -and $_.arch -eq 'x64' })
$model = @($catalog.models | Where-Object id -eq 'whisper-tiny-q5_1')
if ($asrAsset.Count -ne 1 -or $model.Count -ne 1) { throw 'Expected one pinned CPU ASR engine and multilingual tiny model' }
$asrArchive = Download $asrAsset[0] (Join-Path $Output 'downloads')
$asrModel = Download $model[0] (Join-Path $Output 'downloads')
Extract $asrArchive (Join-Path $Output 'whisper')
$asr = @(Get-ChildItem (Join-Path $Output 'whisper') -Recurse -File -Filter whisper-cli.exe)
if ($asr.Count -ne 1) { throw 'Expected one whisper-cli executable' }
# GitHub's Windows runner contains licensed Visual Studio redistribution files.
# Read only its Redist directory, never the build machine's System32 DLLs.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = (& $vswhere -latest -products '*' -property installationPath).Trim()
if (-not $vs) { throw 'Visual Studio redistributable source is unavailable' }
$vcVersion = Get-ChildItem (Join-Path $vs 'VC/Redist/MSVC') -Directory | Where-Object Name -match '^\d+\.\d+\.\d+$' | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $vcVersion) { throw 'No versioned Visual Studio redistributables' }
$vcRoot = Join-Path $vcVersion.FullName 'x64'
$vcOutput = Join-Path $Output 'vc-redist'
New-Item -ItemType Directory -Path $vcOutput | Out-Null
$vcFiles = [ordered]@{}
foreach ($name in @('msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll','vcomp140.dll')) {
    $vcCandidates = @(Get-ChildItem $vcRoot -Recurse -File -Filter $name)
    if ($vcCandidates.Count -ne 1) { throw "Expected one x64 VS redistributable: $name" }
    $signature = Get-AuthenticodeSignature -LiteralPath $vcCandidates[0].FullName
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') { throw "Unverified Microsoft DLL: $name" }
    Copy-Item -LiteralPath $vcCandidates[0].FullName -Destination (Join-Path $vcOutput $name)
    $vcFiles[$name] = @{ version=$vcCandidates[0].VersionInfo.FileVersion; sha256=(Get-FileHash $vcCandidates[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
& (Join-Path $core 'scripts/prepare-desktop-resources.ps1') -OutputRoot $Product -PythonArchive $pythonArchive -PythonWheelRoot $wheelRoot -BrowserSource $chromes[0].DirectoryName -AsrSource $asr[0].DirectoryName -AsrModel $asrModel -VCRedistSource $vcOutput
$notices = Join-Path $Product 'r/licenses'
New-Item -ItemType Directory -Path $notices | Out-Null
# Licenses are taken from the engine's immutable version and model revision.
Invoke-WebRequest "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v$($catalog.engine.version)/LICENSE" -OutFile (Join-Path $notices 'LICENSE-whisper.cpp') -MaximumRetryCount 3
Invoke-WebRequest 'https://raw.githubusercontent.com/openai/whisper/v20250625/LICENSE' -OutFile (Join-Path $notices 'LICENSE-whisper-model') -MaximumRetryCount 3
@"
Python: python-build-standalone; license files retained inside r/p.
Office wheels: dist-info licenses retained inside r/v/Lib/site-packages.
Chromium: complete official Playwright Chromium payload retained in r/b.
Whisper.cpp $($catalog.engine.version) and Whisper tiny q5_1: MIT, licenses in this directory.
Microsoft Visual C++ redistributable DLLs: Visual Studio $($vcVersion.Name), x64 Redist directory, Microsoft Authenticode verified.
Redistribution list: https://learn.microsoft.com/visualstudio/releases/2022/redistribution
Redistribution terms: https://visualstudio.microsoft.com/license-terms/vs2022-cruntime/
"@ | Set-Content (Join-Path $notices 'NATIVE-COMPONENTS.txt') -Encoding utf8NoBOM
@{schemaVersion=1;node=$node;vcRedist=$vcFiles;browserVersion=$browserVersion;browserURL=$browserURL;browserArchiveSHA256=$browserArchiveSHA256;asrSHA256=$asrAsset[0].sha256;modelSHA256=$model[0].sha256} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $Output 'inputs.json') -Encoding utf8NoBOM
