[CmdletBinding()]
param(
    [string]$Upstream = (Join-Path $PSScriptRoot '..\..\.research\upstream\deepseek-harness'),
    [string]$Report = '',
    [string]$LockPath = '',
    [string]$SnapshotPath = ''
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Upstream = [IO.Path]::GetFullPath($Upstream)
if ([string]::IsNullOrWhiteSpace($LockPath)) { $LockPath = Join-Path $repositoryRoot 'third_party\dsh\LOCK.json' }
$lockPath = [IO.Path]::GetFullPath($LockPath)
if ([string]::IsNullOrWhiteSpace($SnapshotPath)) { $SnapshotPath = Join-Path (Split-Path -Parent $lockPath) 'DSH-CONTRACT-SNAPSHOT.json' }
$snapshotPath = [IO.Path]::GetFullPath($SnapshotPath)
$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
$snapshot = Get-Content -Raw -LiteralPath $snapshotPath | ConvertFrom-Json
$failures = [Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) {
    $failures.Add($Message)
}

function Resolve-UpstreamPath([string]$RelativePath) {
    return Join-Path $Upstream ($RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar))
}

if ($snapshot.upstreamCommit -ne $lock.commit) {
    Add-Failure "snapshot commit $($snapshot.upstreamCommit) does not match lock commit $($lock.commit)"
}

if (Test-Path -LiteralPath (Join-Path $Upstream '.git')) {
    $actualCommit = (& git -C $Upstream rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $lock.commit) {
        Add-Failure "upstream commit mismatch: expected $($lock.commit), got $actualCommit"
    }
    & git -C $Upstream diff --quiet --ignore-submodules --exit-code -- .
    if ($LASTEXITCODE -ne 0) {
        Add-Failure 'upstream tracked files contain product or local modifications; DSH mainline must remain read-only'
    }
    & git -C $Upstream diff --cached --quiet --ignore-submodules --exit-code -- .
    if ($LASTEXITCODE -ne 0) {
        Add-Failure 'upstream tracked files contain staged modifications; DSH mainline must remain read-only'
    }
} else {
    $sourceMarkerPath = Join-Path $Upstream '.dsh-source-lock.json'
    if (-not (Test-Path -LiteralPath $sourceMarkerPath -PathType Leaf)) {
        Add-Failure "upstream source has neither Git metadata nor a verified source-archive marker: $Upstream"
    } else {
        try {
            $sourceMarker = Get-Content -Raw -LiteralPath $sourceMarkerPath | ConvertFrom-Json
            if ([int]$sourceMarker.schemaVersion -ne 1 -or
                [string]$sourceMarker.commit -ne [string]$lock.commit -or
                [string]$sourceMarker.repository -ne [string]$lock.repository -or
                [string]$sourceMarker.sourceArchiveSHA256 -ne [string]$lock.sourceArchiveSHA256) {
                Add-Failure 'verified source-archive marker does not match third_party/dsh/LOCK.json'
            }
        } catch {
            Add-Failure "verified source-archive marker is invalid: $($_.Exception.Message)"
        }
    }
}

$rootManifestPath = Join-Path $Upstream 'package.json'
if (Test-Path -LiteralPath $rootManifestPath) {
    $rootManifest = Get-Content -Raw -LiteralPath $rootManifestPath | ConvertFrom-Json
    if ($rootManifest.version -ne $lock.packageVersion) {
        Add-Failure "root package version mismatch: expected $($lock.packageVersion), got $($rootManifest.version)"
    }
} else {
    Add-Failure 'upstream package.json is missing'
}

$pnpmLockPath = Join-Path $Upstream 'pnpm-lock.yaml'
if (Test-Path -LiteralPath $pnpmLockPath) {
    $actualLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $pnpmLockPath).Hash.ToLowerInvariant()
    if ($actualLockHash -ne $lock.pnpmLockSHA256) {
        Add-Failure "pnpm lock hash mismatch: expected $($lock.pnpmLockSHA256), got $actualLockHash"
    }
} else {
    Add-Failure 'upstream pnpm-lock.yaml is missing'
}

foreach ($package in $snapshot.packages) {
    $path = Resolve-UpstreamPath $package.path
    if (-not (Test-Path -LiteralPath $path)) {
        Add-Failure "package manifest is missing: $($package.path)"
        continue
    }
    $manifest = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    if ($manifest.name -ne $package.name) {
        Add-Failure "$($package.path) name mismatch: expected $($package.name), got $($manifest.name)"
    }
    $expectedPackageVersion = if ([string]$package.name -like '@deepseek-ai/dsh-*') { [string]$lock.packageVersion } else { [string]$package.version }
    if ($manifest.version -ne $expectedPackageVersion) {
        Add-Failure "$($package.name) version mismatch: expected $expectedPackageVersion, got $($manifest.version)"
    }
    $availableExports = @($manifest.exports.PSObject.Properties.Name)
    foreach ($requiredExport in $package.requiredExports) {
        if ($availableExports -notcontains $requiredExport) {
            Add-Failure "$($package.name) no longer exports $requiredExport"
        }
    }
}

foreach ($anchor in $snapshot.sourceAnchors) {
    $path = Resolve-UpstreamPath $anchor.path
    if (-not (Test-Path -LiteralPath $path)) {
        Add-Failure "contract source is missing: $($anchor.path)"
        continue
    }
    $content = Get-Content -Raw -LiteralPath $path
    $actualCount = ([regex]::Matches($content, [regex]::Escape([string]$anchor.text))).Count
    if ($actualCount -ne [int]$anchor.count) {
        Add-Failure "$($anchor.path) anchor '$($anchor.text)' expected $($anchor.count), got $actualCount ($($anchor.purpose))"
    }
}

$result = [ordered]@{
    schemaVersion = 1
    checkedAt = (Get-Date).ToString('o')
    upstream = $Upstream
    expectedCommit = $lock.commit
    packageVersion = $lock.packageVersion
    packageContracts = @($snapshot.packages).Count
    sourceAnchors = @($snapshot.sourceAnchors).Count
    passed = $failures.Count -eq 0
    failures = @($failures)
}

if (-not [string]::IsNullOrWhiteSpace($Report)) {
    $Report = [IO.Path]::GetFullPath($Report)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Report) -Force | Out-Null
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding utf8NoBOM
}

if ($failures.Count -gt 0) {
    $details = $failures | ForEach-Object { " - $_" }
    throw "DSH compatibility gate failed:`n$($details -join "`n")"
}

Write-Host "DSH compatibility gate passed: $($lock.packageVersion) / $($lock.commit)"
