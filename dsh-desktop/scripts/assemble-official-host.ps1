[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Product,
    [Parameter(Mandatory)][string]$HostAdapter,
    [Parameter(Mandatory)][string]$Output,
    [string]$Version,
    [string]$Node = (Get-Command node.exe -ErrorAction Stop).Source
)
$ErrorActionPreference = 'Stop'
$core = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$Product = [IO.Path]::GetFullPath($Product)
$HostAdapter = [IO.Path]::GetFullPath($HostAdapter)
$Output = [IO.Path]::GetFullPath($Output)
$Node = [IO.Path]::GetFullPath($Node)
function Is-Inside([string]$Root,[string]$Path) {
    $prefix = $Root.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
    return $Path.Equals($Root,[StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)
}
if ($Output -match '(?i)(^|[\\/])current([\\/]|$)') { throw 'Wails candidates cannot replace current' }
if ((Is-Inside $Product $Output) -or (Is-Inside $Output $Product)) { throw 'Product and output directories must be separate' }
if (Test-Path -LiteralPath $Output) { throw 'Use a new Wails candidate directory; existing candidates and data are never replaced' }
$identity = Get-Content -LiteralPath (Join-Path $Product 'assembly.json') -Raw | ConvertFrom-Json
$hostReceipt = Get-Content -LiteralPath (Join-Path $HostAdapter 'receipt.json') -Raw | ConvertFrom-Json
if ($identity.dshCommit -ne $hostReceipt.upstreamCommit -or $identity.dshVersion -ne '0.1.5-rc.2' -or $identity.dshVersion -ne $hostReceipt.upstreamVersion) { throw 'Candidate product and Host do not match the qualified baseline' }
if ($identity.distribution -notmatch '^[a-z0-9-]+$') { throw 'Invalid distribution identity' }
if (-not $Version) { $Version=$identity.version }
& $Node (Join-Path $core 'scripts/verify-product-release-identity.mjs') $Product $Version
if ($LASTEXITCODE -ne 0) { throw 'Product release identity verification failed' }
$nodeVersion=(& $Node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne 'v24.18.0' -or $hostReceipt.nodeVersion -ne $nodeVersion) { throw 'Candidate Node must match the prepared Host Node 24.18.0' }
$nodeLicense=Join-Path (Split-Path $Node -Parent) 'LICENSE'
if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) { throw 'Node LICENSE must accompany the supplied Node runtime' }
function Copy-Tree([string]$Source,[string]$Destination) {
    $nativeErrors = $PSNativeCommandUseErrorActionPreference
    try {
        $PSNativeCommandUseErrorActionPreference = $false
        & robocopy.exe $Source $Destination /E /XJ /XF *.map *.pdb *.pyc default_app.asar /XD __pycache__ /COPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Candidate payload copy failed: $Source" }
        $global:LASTEXITCODE = 0
    } finally { $PSNativeCommandUseErrorActionPreference = $nativeErrors }
}
New-Item -ItemType Directory -Path $Output | Out-Null
$resources = Join-Path $Output 'resources'
Copy-Tree $Product (Join-Path $resources 'product')
$hostOutput = Join-Path $resources 'host'
New-Item -ItemType Directory -Path $hostOutput -Force | Out-Null
foreach ($file in @('host-process.mjs','host-protocol.mjs','receipt.json','LICENSE-DeepSeek')) {
    Copy-Item -LiteralPath (Join-Path $HostAdapter $file) -Destination (Join-Path $hostOutput $file)
}
foreach ($file in @('bridge.mjs','wire.mjs','product-profile.mjs','product-presets.mjs','product-profile-cli.mjs','native-resources.mjs','user-config.mjs','enterprise-model-updates.mjs','desktop-updates.mjs','release-policy.mjs','workbench-support.mjs','diagnostics.mjs','wails-migration.mjs')) {
    Copy-Item -LiteralPath (Join-Path $core "dsh-host/$file") -Destination (Join-Path $hostOutput $file)
}
Copy-Item -LiteralPath (Join-Path $core 'dsh-plugins/media-openai/lib/config.js') -Destination (Join-Path $hostOutput 'media-config.mjs')
Copy-Item -LiteralPath (Join-Path $core 'dsh-electron/src/legacy-migration.mjs') -Destination (Join-Path $hostOutput 'legacy-migration.mjs')
Copy-Tree (Join-Path $core 'dsh-host/vendor') (Join-Path $hostOutput 'vendor')
$defaultConfig = Join-Path $Product 'resources/desktop/eduwork.jsonc'
if (-not (Test-Path -LiteralPath $defaultConfig -PathType Leaf)) { $defaultConfig = '' }
& (Join-Path $core 'scripts/install-desktop-config.ps1') -Output $Output -DefaultConfig $defaultConfig
$runtime = Join-Path $resources 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Copy-Item -LiteralPath $Node -Destination (Join-Path $runtime 'node.exe')
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtime 'LICENSE-Node')
Copy-Item -LiteralPath (Join-Path $core 'LICENSE') -Destination (Join-Path $Output 'LICENSE-EduWork')
& (Join-Path $PSScriptRoot 'build-official-host.ps1') -OutputExe (Join-Path $Output 'EduWork.exe') -Node $Node
$config = [ordered]@{
    schemaVersion = 1
    shell = 'wails'
    version = $Version
    productVersion = $identity.version
    appId = "org.eduwork.$($identity.distribution).wails.candidate"
    distribution = $identity.distribution
    productName = $identity.brand.product.name
    product = 'resources/product'
    node = 'resources/runtime/node.exe'
    host = 'resources/host'
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Output 'eduwork.desktop.json') -Encoding utf8NoBOM
[ordered]@{
    schemaVersion = 1; shell = 'wails'; version = $Version; shellVersion = $Version; productVersion = $identity.version; dshVersion = $identity.dshVersion
    transport = 'official-desktop-host-v3-via-node-stdio'; nodeSha256 = (Get-FileHash $Node -Algorithm SHA256).Hash.ToLowerInvariant()
    executableSha256 = (Get-FileHash (Join-Path $Output 'EduWork.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
    host = $hostReceipt
} | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $Output 'candidate-receipt.json') -Encoding utf8NoBOM
Write-Output "Independent Wails candidate prepared: $Output"
