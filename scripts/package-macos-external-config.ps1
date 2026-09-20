#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Config,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$Version,
    [string]$Node = 'node',
    [string]$InstallRoot = '/Library/Application Support/EduWork-ECNU/config',
    [string]$PackageIdentifier = 'org.eduwork.ecnu.config'
)
$ErrorActionPreference = 'Stop'
if (-not $IsMacOS) { throw 'The macOS configuration package must be built on macOS' }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-dev\.\d{8}\.[1-9]\d*)?$') { throw 'An exact product version is required' }
if (-not [IO.Path]::IsPathRooted($InstallRoot)) { throw 'The configuration install root must be absolute' }
if ($InstallRoot -ne '/Library/Application Support/EduWork-ECNU/config') { throw 'Unexpected external configuration install root' }
if ($PackageIdentifier -notmatch '^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$') { throw 'Invalid package identifier' }

$Config = (Resolve-Path -LiteralPath $Config).Path
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Configuration package output must be a new file' }
if ([IO.Path]::GetExtension($Output) -ne '.pkg') { throw 'Configuration package output must use the .pkg extension' }
if ($Node -match '[\\/]') { $Node = (Resolve-Path -LiteralPath $Node).Path }

$validation = & $Node (Join-Path $PSScriptRoot 'validate-distribution-config.mjs') $Config
if ($LASTEXITCODE -ne 0) { throw 'Institution configuration validation failed' }
$configSummary = ($validation | Select-Object -Last 1) | ConvertFrom-Json
$configBytes = [IO.File]::ReadAllBytes($Config)
$configHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($configBytes)).ToLowerInvariant()
$targetName = 'eduwork.jsonc'
$targetPath = "$InstallRoot/$targetName"
$packageVersion = if ($Version -match '^(\d+\.\d+\.\d+)-dev\.(\d{8})\.([1-9]\d*)$') { "$($Matches[1]).$($Matches[2]).$($Matches[3])" } else { $Version }

New-Item -ItemType Directory -Path (Split-Path $Output -Parent) -Force | Out-Null
$staging = Join-Path ([IO.Path]::GetTempPath()) ('eduwork-config-pkg-' + [Guid]::NewGuid().ToString('N'))
try {
    $payload = Join-Path $staging 'payload'
    $payloadConfig = Join-Path $payload ($InstallRoot.TrimStart('/') -replace '/', [IO.Path]::DirectorySeparatorChar)
    New-Item -ItemType Directory -Path $payloadConfig -Force | Out-Null
    $stagedConfig = Join-Path $payloadConfig $targetName
    Copy-Item -LiteralPath $Config -Destination $stagedConfig
    & chmod 644 $stagedConfig
    if ($LASTEXITCODE -ne 0) { throw 'Configuration permission update failed' }
    & xattr -cr $payload
    if ($LASTEXITCODE -ne 0) { throw 'Configuration metadata cleanup failed' }

    & pkgbuild --root $payload --identifier $PackageIdentifier --version $packageVersion --install-location / --ownership recommended $Output
    if ($LASTEXITCODE -ne 0) { throw 'Configuration package build failed' }
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}

$packageHash = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
"$packageHash  $([IO.Path]::GetFileName($Output))" | Set-Content -LiteralPath ($Output + '.sha256') -Encoding utf8NoBOM
$receipt = [ordered]@{
    schemaVersion = 1
    kind = 'eduwork-macos-external-configuration'
    productVersion = $Version
    packageIdentifier = $PackageIdentifier
    installPath = $targetPath
    organizations = $configSummary.organizations
    updateDefaultPolicy = $configSummary.defaultPolicy
    configSHA256 = $configHash
    package = @{ name = [IO.Path]::GetFileName($Output); bytes = (Get-Item $Output).Length; sha256 = $packageHash }
    signed = $false
    notarized = $false
    assembledAt = [DateTime]::UtcNow.ToString('o')
}
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ($Output + '.receipt.json') -Encoding utf8NoBOM
$receipt | ConvertTo-Json -Depth 6
