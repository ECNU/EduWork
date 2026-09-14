[CmdletBinding()]
param(
    [string]$Upstream = (Join-Path $PSScriptRoot '..\..\.research\upstream\deepseek-harness'),
    [string]$SourceArchive = '',
    [string]$LockPath = '',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($LockPath)) { $LockPath = Join-Path $repositoryRoot 'third_party\dsh\LOCK.json' }
$LockPath = [IO.Path]::GetFullPath($LockPath)
$lock = Get-Content -Raw -LiteralPath $LockPath | ConvertFrom-Json
$commit = [string]$lock.commit
$repository = [string]$lock.repository
$Upstream = [IO.Path]::GetFullPath($Upstream)
$archiveURL = [string]$lock.sourceArchiveURL
$archiveSHA256 = ([string]$lock.sourceArchiveSHA256).ToLowerInvariant()
$pnpmVersion = [string]$lock.pnpmVersion
if (-not [string]::IsNullOrWhiteSpace($SourceArchive)) {
    $SourceArchive = [IO.Path]::GetFullPath($SourceArchive)
    if (-not (Test-Path -LiteralPath $SourceArchive -PathType Leaf)) {
        throw "DSH source archive cache is missing: $SourceArchive"
    }
}

function Install-LockedSourceArchive {
    param([string]$Destination)
    $replaceRecognized = $false
    if (Test-Path -LiteralPath $Destination) {
        $marker = Join-Path $Destination '.dsh-source-lock.json'
        if (Test-Path -LiteralPath $marker -PathType Leaf) {
            $current = Get-Content -Raw -LiteralPath $marker | ConvertFrom-Json
            if ([string]$current.commit -eq $commit -and ([string]$current.sourceArchiveSHA256).ToLowerInvariant() -eq $archiveSHA256) { return }
            if ([int]$current.schemaVersion -eq 1 -and [string]$current.repository -eq $repository) {
                $replaceRecognized = $true
            }
        }
        if (-not $replaceRecognized) {
            throw "Refusing to replace an unrecognized DSH source directory: $Destination"
        }
    }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ("chatecnu-dsh-{0}" -f [guid]::NewGuid().ToString('N'))
    $archive = Join-Path $temporary 'source.tar.gz'
    $extract = Join-Path $temporary 'extract'
    try {
        New-Item -ItemType Directory -Path $extract -Force | Out-Null
        if ([string]::IsNullOrWhiteSpace($SourceArchive)) {
            Invoke-WebRequest -UseBasicParsing -Uri $archiveURL -OutFile $archive
        } else {
            Copy-Item -LiteralPath $SourceArchive -Destination $archive
        }
        $actualSHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
        if ($actualSHA256 -ne $archiveSHA256) { throw "DSH source archive SHA-256 mismatch: $actualSHA256" }
        & tar.exe -xzf $archive -C $extract
        if ($LASTEXITCODE -ne 0) { throw "Extracting DSH source archive failed with exit code $LASTEXITCODE" }
        $source = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
        if ($null -eq $source) { throw 'DSH source archive did not contain a root directory.' }
        $destinationParent = Split-Path -Parent $Destination
        $incoming = Join-Path $destinationParent ('.dsh-source-incoming-' + [guid]::NewGuid().ToString('N'))
        $previous = Join-Path $destinationParent ('.dsh-source-previous-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        Move-Item -LiteralPath $source.FullName -Destination $incoming
        @{ schemaVersion = 1; repository = $repository; commit = $commit; sourceArchiveSHA256 = $archiveSHA256 } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $incoming '.dsh-source-lock.json') -Encoding utf8NoBOM
        try {
            if ($replaceRecognized) { Move-Item -LiteralPath $Destination -Destination $previous }
            Move-Item -LiteralPath $incoming -Destination $Destination
            if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }
        } catch {
            if (-not (Test-Path -LiteralPath $Destination) -and (Test-Path -LiteralPath $previous)) {
                Move-Item -LiteralPath $previous -Destination $Destination
            }
            throw
        } finally {
            if (Test-Path -LiteralPath $incoming) { Remove-Item -LiteralPath $incoming -Recurse -Force }
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $Upstream '.git'))) {
    Install-LockedSourceArchive -Destination $Upstream
}

if (Test-Path -LiteralPath (Join-Path $Upstream '.git')) {
    $actual = (git -C $Upstream rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect DSH Git checkout: $Upstream" }
    if ($actual -ne $commit) {
        git -C $Upstream fetch origin $commit --depth=1
        if ($LASTEXITCODE -ne 0) { throw "Cannot fetch locked DSH commit $commit. The archive fallback is used only for a clean source directory." }
        git -C $Upstream checkout --detach $commit
        if ($LASTEXITCODE -ne 0) { throw "Cannot checkout locked DSH commit $commit" }
    }
}

& (Join-Path $PSScriptRoot 'test-dsh-compatibility.ps1') -Upstream $Upstream -LockPath $LockPath

if (-not $SkipBuild) {
    if ($lock.runtime.source.buildNormalization) {
        & node (Join-Path $PSScriptRoot '../../scripts/patch-eduwork-source-reproducibility.mjs') --upstream $Upstream --lock $LockPath
        if ($LASTEXITCODE) { throw 'Reviewed source build normalization failed' }
    }
    $proxyDirectory = $null
    $previousPath = $env:Path
    $previousPnpmNode = $env:CHATECNU_PNPM_NODE
    $previousCorepackJS = $env:CHATECNU_COREPACK_JS
    $previousPnpmVersion = $env:CHATECNU_PNPM_VERSION
    $previousClientCommit = $env:DSH_CLIENT_COMMIT_HASH
    Push-Location $Upstream
    try {
        $env:DSH_CLIENT_COMMIT_HASH = $commit
        if ($IsWindows) {
            $node = (Get-Command node.exe -ErrorAction Stop).Source
            $corepackScript = Join-Path (Split-Path -Parent $node) 'node_modules\corepack\dist\corepack.js'
            if (-not (Test-Path -LiteralPath $corepackScript -PathType Leaf)) {
                throw "Corepack JavaScript entry not found beside Node.js: $corepackScript"
            }
            $proxyDirectory = Join-Path ([IO.Path]::GetTempPath()) ('chatecnu-pnpm-proxy-' + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $proxyDirectory -Force | Out-Null
            $proxy = Join-Path $proxyDirectory 'pnpm.exe'
            & go build -trimpath '-ldflags=-s -w' -o $proxy (Join-Path $PSScriptRoot 'pnpm-proxy-windows.go')
            if ($LASTEXITCODE -ne 0) { throw "Building locked pnpm proxy failed with exit code $LASTEXITCODE" }
            $env:Path = "$proxyDirectory;$previousPath"
            $env:CHATECNU_PNPM_NODE = $node
            $env:CHATECNU_COREPACK_JS = $corepackScript
            $env:CHATECNU_PNPM_VERSION = $pnpmVersion
        }
        corepack pnpm@$pnpmVersion install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw "DSH dependency installation failed with exit code $LASTEXITCODE" }
        corepack pnpm@$pnpmVersion run clean
        if ($LASTEXITCODE -ne 0) { throw "Cleaning stale DSH build outputs failed with exit code $LASTEXITCODE" }
        corepack pnpm@$pnpmVersion run build:official
        if ($LASTEXITCODE -ne 0) { throw "DSH build failed with exit code $LASTEXITCODE" }
        $releasePackRoot = Join-Path $Upstream 'dist\chatecnu-source-runtime'
        if (Test-Path -LiteralPath $releasePackRoot) {
            Remove-Item -LiteralPath $releasePackRoot -Recurse -Force
        }
        $sourcePackage = Get-Content -LiteralPath (Join-Path $Upstream 'package.json') -Raw | ConvertFrom-Json
        $packInvocation = if ($sourcePackage.scripts.'release:pack') { @('run','release:pack') } else { @('exec','tsx','scripts/release/pack.ts') }
        corepack pnpm@$pnpmVersion @packInvocation --family vendor --out dist/chatecnu-source-runtime/vendor --concurrency 4
        if ($LASTEXITCODE -ne 0) { throw "DSH vendor release packing failed with exit code $LASTEXITCODE" }
        corepack pnpm@$pnpmVersion @packInvocation --family dsh --out dist/chatecnu-source-runtime/dsh --concurrency 4
        if ($LASTEXITCODE -ne 0) { throw "DSH package release packing failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
        $env:Path = $previousPath
        $env:CHATECNU_PNPM_NODE = $previousPnpmNode
        $env:CHATECNU_COREPACK_JS = $previousCorepackJS
        $env:CHATECNU_PNPM_VERSION = $previousPnpmVersion
        $env:DSH_CLIENT_COMMIT_HASH = $previousClientCommit
        if ($null -ne $proxyDirectory -and (Test-Path -LiteralPath $proxyDirectory)) {
            Remove-Item -LiteralPath $proxyDirectory -Recurse -Force
        }
    }
}

Write-Host "DSH ready: $commit"
