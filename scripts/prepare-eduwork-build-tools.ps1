#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$CoreRoot = (Join-Path $PSScriptRoot '..'),
    [Parameter(Mandatory)][string]$RuntimePackages,
    [string]$Upstream = '',
    [string]$DshLockPath = '',
    [string]$SourceArchive = ''
)
$ErrorActionPreference = 'Stop'
$CoreRoot = [IO.Path]::GetFullPath($CoreRoot)
$RuntimePackages = [IO.Path]::GetFullPath($RuntimePackages)
$lockPath = if ($DshLockPath) { [IO.Path]::GetFullPath($DshLockPath) } else { Join-Path $CoreRoot 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json' }
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
. (Join-Path $PSScriptRoot 'resolve-eduwork-upstream.ps1')
. (Join-Path $PSScriptRoot 'with-eduwork-upstream-lock.ps1')
$Upstream = Resolve-EduworkUpstream -Commit $lock.commit -Upstream $Upstream
$helper = Join-Path $PSScriptRoot 'prepare-eduwork-build-tools.mjs'
Invoke-WithEduworkUpstreamLock -Upstream $Upstream -Activity 'prepare product client build tools' -Action {
    # Builds use a disposable verified archive, never a developer checkout.
    if (Test-Path -LiteralPath (Join-Path $Upstream '.git')) { throw 'Product build tools require a disposable source archive cache, not a developer Git checkout' }
    $syncOptions = @{ Upstream=$Upstream; LockPath=$lockPath; SkipBuild=$true }
    if ($SourceArchive) { $syncOptions.SourceArchive = [IO.Path]::GetFullPath($SourceArchive) }
    & (Join-Path $CoreRoot 'dsh-desktop/scripts/sync-dsh-upstream.ps1') @syncOptions
    if (-not $?) { throw 'Pinned build source verification failed' }
    & node (Join-Path $CoreRoot 'scripts/patch-eduwork-source-reproducibility.mjs') --upstream $Upstream --lock $lockPath
    if ($LASTEXITCODE) { throw 'Pinned client build normalization failed' }
    $statusJSON = & node $helper --upstream $Upstream --runtime-packages $RuntimePackages --lock $lockPath --phase status
    if ($LASTEXITCODE) { throw 'Pinned build tool input verification failed' }
    $status = $statusJSON | ConvertFrom-Json
    if ($status.installNeeded) {
        $previousElectronSkip = $env:ELECTRON_SKIP_BINARY_DOWNLOAD
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
        Push-Location $Upstream
        try {
            # Only the compiler dependency tree is prepared. No lifecycle
            # scripts, official Runtime build or source release packing runs.
            & corepack "pnpm@$($lock.pnpmVersion)" install --frozen-lockfile --ignore-scripts
            if ($LASTEXITCODE) { throw 'Pinned client build tool dependency installation failed' }
        } finally { Pop-Location; $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $previousElectronSkip }
    }
    & node $helper --upstream $Upstream --runtime-packages $RuntimePackages --lock $lockPath --phase prepare
    if ($LASTEXITCODE) { throw 'Pinned product client build tool preparation failed' }
    Write-Output "Product client build tools ready: $Upstream"
}
