#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SourceRelease,
    [Parameter(Mandatory)][string]$CurrentVersion,
    [Parameter(Mandatory)][string]$CandidateZIP,
    [Parameter(Mandatory)][string]$CandidateVersion,
    [Parameter(Mandatory)][string]$TargetRoot,
    [Parameter(Mandatory)][string]$Report,
    [switch]$HeadlessClient
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date
$source = [IO.Path]::GetFullPath($SourceRelease).TrimEnd('\')
$target = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
$candidate = [IO.Path]::GetFullPath($CandidateZIP)
$reportPath = [IO.Path]::GetFullPath($Report)

if (-not (Test-Path -LiteralPath (Join-Path $source 'ChatECNU-Work.exe') -PathType Leaf)) {
    throw "source portable release is invalid: $source"
}
if (-not (Test-Path -LiteralPath (Join-Path $source 'release.json') -PathType Leaf)) {
    throw "source release identity is missing: $source"
}
$sourceIdentity = Get-Content -LiteralPath (Join-Path $source 'release.json') -Raw | ConvertFrom-Json
if ([string]$sourceIdentity.version -ne $CurrentVersion) {
    throw "source release version is $($sourceIdentity.version), expected $CurrentVersion"
}
if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    throw "candidate ZIP is missing: $candidate"
}
$sidecar = $candidate + '.sha256'
if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) {
    throw "candidate SHA-256 sidecar is missing: $sidecar"
}
$candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
$sidecarHash = ((Get-Content -LiteralPath $sidecar -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
if ($candidateHash -ne $sidecarHash) {
    throw "candidate ZIP SHA-256 mismatch: $candidateHash != $sidecarHash"
}
if (Test-Path -LiteralPath $target) {
    throw "compatibility target already exists: $target"
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
& robocopy.exe $source $target /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "copy old portable release failed with robocopy exit code $LASTEXITCODE"
}
$global:LASTEXITCODE = 0

$stateDir = Join-Path $target 'data\state'
$sentinel = Join-Path $target 'data\update-compat-user-data.txt'
New-Item -ItemType Directory -Path (Split-Path -Parent $sentinel) -Force | Out-Null
Set-Content -LiteralPath $sentinel -Value 'preserve me' -Encoding utf8NoBOM
$legacyRelative = 'attachments/update-compat-' + [guid]::NewGuid().ToString('N') + '.txt'
$legacySentinel = Join-Path $target ('data/dsh/' + $legacyRelative)
New-Item -ItemType Directory -Path (Split-Path $legacySentinel -Parent) -Force | Out-Null
Set-Content -LiteralPath $legacySentinel -Value 'preserve and import me' -Encoding utf8NoBOM
$readyFile = Join-Path $stateDir 'updates/client-ready.json'
$restartArgs = @('run', '--write-ready', $readyFile, '--exit-after', '25s')
if ($HeadlessClient) { $restartArgs += '--no-window' }

$downloadDir = Join-Path $stateDir "updates\downloads\$CandidateVersion"
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$downloadZIP = Join-Path $downloadDir ([IO.Path]::GetFileName($candidate))
try {
    New-Item -ItemType HardLink -Path $downloadZIP -Target $candidate -ErrorAction Stop | Out-Null
} catch {
    Copy-Item -LiteralPath $candidate -Destination $downloadZIP
}

$pendingPath = Join-Path $stateDir 'updates\pending-update.json'
$pending = [ordered]@{
    schemaVersion = 1
    version = $CandidateVersion
    channel = 'development'
    flavor = 'offline'
    zipPath = $downloadZIP
    sha256 = $candidateHash
    installDir = $target
    executableName = 'ChatECNU-Work.exe'
    restartArgs = $restartArgs
    state = 'ready'
    installOnNextStart = $false
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
}
$pending | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $pendingPath -Encoding utf8NoBOM

$oldExecutable = Join-Path $target 'ChatECNU-Work.exe'
$oldHelper = Join-Path $stateDir 'updates\e2e-installed-updater.exe'
Copy-Item -LiteralPath $oldExecutable -Destination $oldHelper -Force
$oldHelperHash = (Get-FileHash -LiteralPath $oldHelper -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "[update-compat] applying $CurrentVersion -> $CandidateVersion with the installed old helper" -ForegroundColor Cyan
$previousHeadless = $env:CHATECNU_UPDATE_HELPER_HEADLESS
try {
    $env:CHATECNU_UPDATE_HELPER_HEADLESS = '1'
    $process=Start-Process -FilePath $oldHelper -ArgumentList @('apply-update','--pending',('"'+$pendingPath+'"'),'--pid','0') -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        throw "installed old updater helper failed with exit code $($process.ExitCode)"
    }
} finally {
    $env:CHATECNU_UPDATE_HELPER_HEADLESS = $previousHeadless
}

$deadline = (Get-Date).AddSeconds(30)
do {
    $running = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)
    })
    if ($running.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if ($running.Count -gt 0) {
    $summary = ($running | ForEach-Object { "$($_.ProcessId):$($_.Name)" }) -join ', '
    throw "updated compatibility process did not exit cleanly: $summary"
}

$updatedIdentity = Get-Content -LiteralPath (Join-Path $target 'release.json') -Raw | ConvertFrom-Json
if ([string]$updatedIdentity.version -ne $CandidateVersion) {
    throw "updated release version is $($updatedIdentity.version), expected $CandidateVersion"
}
if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne 'preserve me') {
    throw 'portable user data was not preserved'
}
if (-not (Test-Path -LiteralPath $readyFile -PathType Leaf)) { throw 'updated client did not report ready' }
$desktop = Get-Content -LiteralPath (Join-Path $target 'eduwork.desktop.json') -Raw | ConvertFrom-Json
$importedHome = Join-Path $target ('data/' + $desktop.distribution + '-wails/dsh')
$migration = Get-Content -LiteralPath (Join-Path $importedHome '.eduwork-migration.json') -Raw | ConvertFrom-Json
if ($migration.state -ne 'imported') { throw 'legacy DSH home was not imported' }
foreach ($file in @($legacySentinel, (Join-Path $importedHome $legacyRelative))) {
    if ((Get-Content -LiteralPath $file -Raw).Trim() -ne 'preserve and import me') { throw 'legacy DSH attachment changed or was not imported' }
}
if (Test-Path -LiteralPath $pendingPath) {
    throw 'successful legacy-helper update retained pending state'
}
if (Test-Path -LiteralPath (Join-Path $stateDir 'updates\transactions')) {
    throw 'successful legacy-helper update retained transaction state'
}

$reportData = [ordered]@{
    schemaVersion = 1
    passed = $true
    currentVersion = $CurrentVersion
    candidateVersion = $CandidateVersion
    sourceRelease = $source
    candidateZIP = $candidate
    candidateSHA256 = $candidateHash
    oldHelperSHA256 = $oldHelperHash
    userDataPreserved = $true
    legacyDSHDataImported = $true
    clientMode = $(if ($HeadlessClient) { 'headless-only-not-GUI-acceptance' } else { 'real-window' })
    clientReady = $true
    pendingStateRemoved = $true
    transactionStateRemoved = $true
    startedAt = $startedAt.ToUniversalTime().ToString('o')
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
}
New-Item -ItemType Directory -Path (Split-Path -Parent $reportPath) -Force | Out-Null
$reportData | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8NoBOM
Write-Host "[update-compat] passed with old helper; report: $reportPath" -ForegroundColor Green
