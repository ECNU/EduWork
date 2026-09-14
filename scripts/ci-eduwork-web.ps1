#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$CoreRoot = (Join-Path $PSScriptRoot '..'),
    [string]$EditionRoot = '',
    [string]$DistributionConfig = 'config/distributions/generic.json',
    [string]$Version = '',
    [string]$Output = '',
    [string]$RuntimeSource = '',
    [string]$Upstream = '',
    [switch]$VerifySnapshot,
    [switch]$BuildOnly
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$CoreRoot = [IO.Path]::GetFullPath($CoreRoot)
if (-not $EditionRoot) { $EditionRoot = $CoreRoot }
$EditionRoot = [IO.Path]::GetFullPath($EditionRoot)
$institution = $CoreRoot -ne $EditionRoot
if (-not $Output) { $Output = Join-Path $CoreRoot 'dist/ci-local-web' }
$Output = [IO.Path]::GetFullPath($Output)
$evidence = Join-Path $Output 'evidence'
$assemblyOutput = Join-Path $Output 'assembly'
if (Test-Path -LiteralPath $Output) { throw "Use an empty CI output directory: $Output" }
$auditReports = [ordered]@{}
$result = [ordered]@{ schemaVersion=1; kind='eduwork-local-web-ci'; startedAt=(Get-Date).ToUniversalTime().ToString('o'); edition=$(if ($institution) {'ecnu'} else {'generic'}); sourceAudit='pending'; build='pending'; functionalValidation='pending'; desktopRelease='deferred'; passed=$false }
try {
    $sourceReceiptPath = Join-Path $CoreRoot 'source-receipt.json'
    $sourceReceipt = Get-Content -Raw -LiteralPath $sourceReceiptPath | ConvertFrom-Json
    if (-not $Version) { $Version = [string]$sourceReceipt.version }
    $result.version = $Version
    $auditScript = Join-Path $CoreRoot 'scripts/audit-eduwork-distribution.mjs'
    $auditArgs = @($auditScript, '--root', $CoreRoot, '--edition', 'generic')
    if ($VerifySnapshot -or $institution) { $auditArgs += '--verify-receipt' }
    $auditReports['core-source-audit.json'] = (& node @auditArgs) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Public-core source audit failed.' }
    if ($institution) {
        $coreLock = Get-Content -Raw -LiteralPath (Join-Path $EditionRoot 'core.lock.json') | ConvertFrom-Json
        if ($coreLock.repository -ne 'https://github.com/ecnu/EduWork.git' -or $coreLock.commit -notmatch '^[a-f0-9]{40}$') { throw 'The institution must pin an exact public core commit.' }
        $actualCommit = (& git -C $CoreRoot rev-parse HEAD).Trim()
        if ($actualCommit -ne $coreLock.commit -or $sourceReceipt.fileSetSHA256 -ne $coreLock.sourceFileSetSHA256) { throw 'The checked-out core differs from the institution core.lock.json.' }
        $editionAuditArgs = @($auditScript, '--root', $EditionRoot, '--edition', 'ecnu')
        if ($VerifySnapshot) { $editionAuditArgs += '--verify-receipt' }
        $auditReports['institution-source-audit.json'] = (& node @editionAuditArgs) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw 'Institution source audit failed.' }
        $result.coreCommit = $actualCommit
    }
    $result.sourceAudit = 'passed'
    New-Item -ItemType Directory -Path $evidence -Force | Out-Null
    $assemble = Join-Path $CoreRoot 'scripts/assemble-eduwork-web.ps1'
    $test = Join-Path $CoreRoot 'scripts/test-eduwork-web.mjs'
    foreach ($entry in @($assemble, $test, (Join-Path $CoreRoot 'scripts/prepare-eduwork-web-runtime.ps1'))) {
        if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw "The shared Web build/validation entry is missing: $entry" }
    }
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    $buildArguments = @{ CoreRoot=$CoreRoot; EditionRoot=$EditionRoot; DistributionConfig=$DistributionConfig; Output=$assemblyOutput; Version=$Version }
    if ($RuntimeSource) { $buildArguments.RuntimeSource=[IO.Path]::GetFullPath($RuntimeSource) }
    if ($Upstream) { $buildArguments.Upstream=[IO.Path]::GetFullPath($Upstream) }
    $result.explicitRuntimeCache = [bool]$RuntimeSource
    & $assemble @buildArguments *>&1 | Tee-Object -FilePath (Join-Path $evidence 'build.log')
    if (-not (Test-Path -LiteralPath (Join-Path $assemblyOutput 'assembly.json'))) { throw 'The assembled component receipt is missing.' }
    $componentReceipt = Get-Content -LiteralPath (Join-Path $assemblyOutput 'assembly.json') -Raw | ConvertFrom-Json
    if ($componentReceipt.runtimeMode -ne 'npm' -or $componentReceipt.pluginMode -ne 'npm' -or @($componentReceipt.managedPackages.PSObject.Properties | Where-Object { $_.Value.source -ne 'npm' }).Count) { throw 'Default CI must validate the npm Runtime and registry-installed independent plugins' }
    $result.dependencySource = 'npm-exact-locks'
    Copy-Item -LiteralPath (Join-Path $assemblyOutput 'assembly.json') -Destination (Join-Path $evidence 'assembly.json')
    $result.build = 'passed'
    if ($BuildOnly) {
        $result.functionalValidation = 'not-run-build-only'
    } else {
        & node $test --assembly $assemblyOutput --evidence $evidence --mode clean-ci *>&1 | Tee-Object -FilePath (Join-Path $evidence 'functional-validation.log')
        if ($LASTEXITCODE -ne 0) { throw 'Local Web functional validation failed.' }
        $validationReports = @(Get-ChildItem -LiteralPath $evidence -Directory -Filter 'run-*' | ForEach-Object {
            $path = Join-Path $_.FullName 'result.json'
            if (Test-Path -LiteralPath $path -PathType Leaf) { Get-Content -LiteralPath $path -Raw | ConvertFrom-Json }
        })
        if ($validationReports.Count -ne 1 -or $validationReports[0].passed -ne $true -or $validationReports[0].mode -ne 'clean-ci') {
            throw 'Local Web validation must produce one successful clean-ci result; a zero exit code alone is insufficient.'
        }
        $result.functionalValidation = 'passed'
    }
    $result.passed = $true
} catch {
    $result.error = $_.Exception.Message
    throw
} finally {
    New-Item -ItemType Directory -Path $evidence -Force | Out-Null
    foreach ($report in $auditReports.GetEnumerator()) {
        $report.Value | Set-Content -LiteralPath (Join-Path $evidence $report.Key) -Encoding utf8NoBOM
    }
    $result.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidence 'ci-result.json') -Encoding utf8NoBOM
    # The smoke runner owns a private home/config/authenticated local URL below
    # evidence. Share only reports designed to be redacted, never that runtime.
    $publicEvidence = Join-Path $evidence 'public'
    New-Item -ItemType Directory -Path $publicEvidence -Force | Out-Null
    foreach ($name in @('ci-result.json','core-source-audit.json','institution-source-audit.json','assembly.json')) {
        $source = Join-Path $evidence $name
        if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination (Join-Path $publicEvidence $name) }
    }
    foreach ($run in Get-ChildItem -LiteralPath $evidence -Directory -Filter 'run-*') {
        if ($run.LinkType) { throw 'Validation evidence must not follow a directory link' }
        $report = Join-Path $run.FullName 'result.json'
        if (Test-Path -LiteralPath $report -PathType Leaf) {
            Copy-Item -LiteralPath $report -Destination (Join-Path $publicEvidence ($run.Name + '-result.json'))
        }
    }
}
