#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$CoreRoot = (Join-Path $PSScriptRoot '..'),
    [Parameter(Mandatory)][string]$Output,
    [string]$Upstream = '',
    [string]$DshLockPath = '',
    [ValidateSet('npm', 'source')][string]$Source = 'npm'
)
$ErrorActionPreference = 'Stop'
$CoreRoot = [IO.Path]::GetFullPath($CoreRoot)
$Output = [IO.Path]::GetFullPath($Output)
if ($Output -eq [IO.Path]::GetPathRoot($Output) -or $Output -eq $CoreRoot) { throw 'Runtime output must name a dedicated build directory' }
$defaultLock = if ($Source -eq 'npm') { 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json' } else { 'third_party/dsh/development-v0.1.5-rc.1/LOCK.json' }
$lockPath = if ($DshLockPath) { [IO.Path]::GetFullPath($DshLockPath) } else { Join-Path $CoreRoot $defaultLock }
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
if ($Source -eq 'npm') {
    if ($lock.runtime.npm.available -ne $true) { throw 'Selected lock has no approved npm Runtime; use the release lock or explicit -Source source for development' }
    $identityPath = Join-Path $Output '.chatecnu-dsh-runtime.json'
    if (Test-Path -LiteralPath $identityPath) {
        $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
        $proof = Join-Path $Output '.chatecnu-dsh-npm-install-lock.json'
        $nodePlatform = (& node -p 'JSON.stringify({platform:process.platform,arch:process.arch})') | ConvertFrom-Json
        if ($LASTEXITCODE) { throw 'Unable to identify the runtime Node.js platform' }
        if ($identity.source -eq 'npm-lock' -and $identity.platform -eq $nodePlatform.platform -and $identity.arch -eq $nodePlatform.arch -and $identity.dshVersion -eq $lock.packageVersion -and $identity.dshCommit -eq $lock.commit -and $identity.packageLockSHA256 -eq $lock.runtime.npm.packageLockSHA256 -and (Test-Path -LiteralPath $proof) -and (Get-FileHash -LiteralPath $proof -Algorithm SHA256).Hash.ToLowerInvariant() -eq $lock.runtime.npm.packageLockSHA256) {
            Write-Output "Locked npm Runtime already prepared: $Output"
            return
        }
        throw 'Runtime cache belongs to another build or source. Select a new output directory.'
    }
    if (Test-Path -LiteralPath $Output) { throw 'Refusing to overwrite an unrecognized runtime directory' }
    & node (Join-Path $CoreRoot 'dsh-desktop/scripts/prepare-dsh-runtime.mjs') --output $Output --lock $lockPath --source npm --manifest (Join-Path (Split-Path -Parent $lockPath) $lock.runtime.npm.manifest)
    if ($LASTEXITCODE) { throw 'Pinned npm Runtime preparation failed' }
    return
}
. (Join-Path $PSScriptRoot 'resolve-eduwork-upstream.ps1')
. (Join-Path $PSScriptRoot 'with-eduwork-upstream-lock.ps1')
$Upstream = Resolve-EduworkUpstream -Commit $lock.commit -Upstream $Upstream
Invoke-WithEduworkUpstreamLock -Upstream $Upstream -Activity 'prepare pinned Runtime' -Action {
# Recheck after acquiring the lock: another preparer may have finished while
# this process waited. The source verification, build and pack also stay locked.
$identityPath = Join-Path $Output '.chatecnu-dsh-runtime.json'
if (Test-Path -LiteralPath $identityPath) {
    $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
    if ($identity.source -eq 'source-release-pack' -and $identity.dshVersion -eq $lock.packageVersion -and $identity.dshCommit -eq $lock.commit -and $identity.sourceInstallLockSHA256 -eq $lock.runtime.source.installLockSHA256) {
        Write-Output "Locked Runtime already prepared: $Output"
        return
    }
    throw 'Runtime cache belongs to another build. Select a new output directory.'
}
if (Test-Path -LiteralPath $Output) { throw 'Refusing to overwrite an unrecognized runtime directory' }
$previousElectronSkip = $env:ELECTRON_SKIP_BINARY_DOWNLOAD
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
try {
    & (Join-Path $CoreRoot 'dsh-desktop/scripts/sync-dsh-upstream.ps1') -Upstream $Upstream -LockPath $lockPath -SkipBuild
    if (-not $?) { throw 'Pinned source verification failed' }
    $baseManifest = if (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $lockPath) 'runtime-base.json')) { Join-Path (Split-Path -Parent $lockPath) 'runtime-base.json' } else { Join-Path $CoreRoot 'third_party/dsh/development-v0.1.5-rc.1/runtime-base.json' }
    & node (Join-Path $CoreRoot 'dsh-desktop/scripts/prepare-dsh-runtime.mjs') --output $Output --lock $lockPath --source source --manifest $baseManifest --upstream $Upstream
    if ($LASTEXITCODE) { throw 'Pinned source Runtime preparation failed' }
} finally { $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $previousElectronSkip }
}
