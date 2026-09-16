function Install-LockedDshPackage {
    [CmdletBinding()]
    param(
        [string]$Source = '',
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$LockPath,
        [string[]]$RequiredFiles = @(),
        [string]$NpmCommand = 'npm'
    )

    $Destination = [IO.Path]::GetFullPath($Destination)
    $LockPath = [IO.Path]::GetFullPath($LockPath)
    if (-not (Test-Path -LiteralPath $LockPath -PathType Leaf)) { throw "Locked DSH package input is missing: $LockPath" }

    $lock = Get-Content -Raw -LiteralPath $LockPath | ConvertFrom-Json
    $packageName = [string]$lock.name
    if ([string]::IsNullOrWhiteSpace($packageName) -or [string]::IsNullOrWhiteSpace([string]$lock.version)) {
        throw "Locked DSH package identity is incomplete: $LockPath"
    }

    function Resolve-PackageArtifactPath {
        param(
            [Parameter(Mandatory = $true)][string]$PackageRoot,
            [Parameter(Mandatory = $true)][string]$RelativePath
        )
        if ([string]::IsNullOrWhiteSpace($RelativePath) -or
            [IO.Path]::IsPathRooted($RelativePath) -or
            $RelativePath -split '[/\\]' -contains '..') {
            throw "$packageName required artifact must be a package-relative path without parent traversal: $RelativePath"
        }
        $separator = [IO.Path]::DirectorySeparatorChar
        $rootFull = [IO.Path]::GetFullPath($PackageRoot).TrimEnd($separator, [IO.Path]::AltDirectorySeparatorChar)
        $resolved = [IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath))
        if (-not $resolved.StartsWith($rootFull + $separator, [StringComparison]::OrdinalIgnoreCase)) {
            throw "$packageName required artifact escapes the package root: $RelativePath"
        }
        return $resolved
    }
    $fromSource = -not [string]::IsNullOrWhiteSpace($Source)
    # Published releases are fetched by exact npm identity. Retained review
    # tarballs are evidence, not an implicit fallback when the registry fails.
    $fromRegistry = -not $fromSource -and [string]$lock.publicationStatus -eq 'published'
    $localTarball = ''
    if (-not $fromSource -and -not $fromRegistry -and -not [string]::IsNullOrWhiteSpace([string]$lock.tarball)) {
        $localTarball = Resolve-PackageArtifactPath -PackageRoot (Split-Path -Parent $LockPath) -RelativePath ([string]$lock.tarball)
        $tarballItem = Get-Item -LiteralPath $localTarball
        if (-not $tarballItem.PSIsContainer -and $tarballItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Locked package tarball must not be a link.' }
        if ($tarballItem.PSIsContainer) { throw 'Locked package tarball must be a regular file.' }
    }
    if ($fromSource) {
        $Source = [IO.Path]::GetFullPath($Source)
        $sourceManifestPath = Join-Path $Source 'package.json'
        if (-not (Test-Path -LiteralPath $sourceManifestPath -PathType Leaf)) { throw "Locked $packageName input is missing: $sourceManifestPath" }
        $manifest = Get-Content -Raw -LiteralPath $sourceManifestPath | ConvertFrom-Json
        if ([string]$manifest.name -ne $packageName -or [string]$manifest.version -ne [string]$lock.version) {
            throw "$packageName package identity mismatch: expected $packageName@$($lock.version), got $($manifest.name)@$($manifest.version)"
        }
        if (Test-Path -LiteralPath (Join-Path $Source '.git')) {
            $sourceCommit = (& git -C $Source rev-parse HEAD).Trim()
            if ($LASTEXITCODE -ne 0 -or $sourceCommit -ne [string]$lock.commit) { throw "$packageName source commit mismatch: expected $($lock.commit), got $sourceCommit" }
            $dirty = (& git -C $Source status --short) -join "`n"
            if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($dirty)) { throw "$packageName source must be clean before packaging:`n$dirty" }
        }
    } elseif ([string]::IsNullOrWhiteSpace([string]$lock.npm.integrity)) {
        throw "$packageName lock has no npm integrity; provide a source override for source assembly."
    }

    $destinationParent = Split-Path -Parent $Destination
    $safeName = $packageName -replace '[^A-Za-z0-9._-]', '-'
    $packRoot = Join-Path $destinationParent (".$safeName-package-staging")
    $separator = [IO.Path]::DirectorySeparatorChar
    $destinationParentFull = [IO.Path]::GetFullPath($destinationParent).TrimEnd($separator, [IO.Path]::AltDirectorySeparatorChar)
    $packRootFull = [IO.Path]::GetFullPath($packRoot)
    if (-not $packRootFull.StartsWith($destinationParentFull + $separator, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to stage $packageName outside the destination parent: $packRootFull"
    }
    if (Test-Path -LiteralPath $packRootFull) { Remove-Item -LiteralPath $packRootFull -Recurse -Force }
    New-Item -ItemType Directory -Path $packRootFull -Force | Out-Null

    try {
        if ($fromSource) {
            Push-Location $Source
            try {
                & $NpmCommand pack --ignore-scripts --pack-destination $packRootFull | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "npm pack failed for $packageName with exit code $LASTEXITCODE" }
            } finally { Pop-Location }
        } elseif ($localTarball) {
            Copy-Item -LiteralPath $localTarball -Destination $packRootFull
        } else {
            & $NpmCommand pack ("{0}@{1}" -f $packageName, $lock.version) --ignore-scripts --registry=https://registry.npmjs.org/ --pack-destination $packRootFull | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "npm pack from registry failed for $packageName with exit code $LASTEXITCODE" }
        }
        $tarballs = @(Get-ChildItem -LiteralPath $packRootFull -File -Filter '*.tgz')
        if ($tarballs.Count -ne 1) { throw "Expected exactly one $packageName tarball, found $($tarballs.Count)" }
        $actualHash = (Get-FileHash -LiteralPath $tarballs[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne [string]$lock.tarballSHA256) {
            throw "$packageName tarball SHA-256 mismatch: expected $($lock.tarballSHA256), got $actualHash"
        }
        $actualIntegrity = 'sha512-' + [Convert]::ToBase64String([Convert]::FromHexString((Get-FileHash -LiteralPath $tarballs[0].FullName -Algorithm SHA512).Hash))
        if (-not [string]::IsNullOrWhiteSpace([string]$lock.npm.integrity) -and $actualIntegrity -ne [string]$lock.npm.integrity) {
            throw "$packageName npm integrity mismatch: expected $($lock.npm.integrity), got $actualIntegrity"
        }

        & tar -xf $tarballs[0].FullName -C $packRootFull
        if ($LASTEXITCODE -ne 0) { throw "Extracting $packageName tarball failed with exit code $LASTEXITCODE" }
        $extracted = Join-Path $packRootFull 'package'
        $extractedManifest = Get-Content -Raw -LiteralPath (Join-Path $extracted 'package.json') | ConvertFrom-Json
        if ([string]$extractedManifest.name -ne $packageName -or [string]$extractedManifest.version -ne [string]$lock.version) {
            throw "Extracted $packageName identity differs from the lock."
        }
        foreach ($required in $RequiredFiles) {
            $requiredPath = Resolve-PackageArtifactPath -PackageRoot $extracted -RelativePath $required
            if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
                throw "Packed $packageName is missing required artifact: $required"
            }
        }
        if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        Copy-Item -LiteralPath $extracted -Destination $Destination -Recurse -Force
    } finally {
        if (Test-Path -LiteralPath $packRootFull) { Remove-Item -LiteralPath $packRootFull -Recurse -Force }
    }

    return [ordered]@{
        name = $packageName
        version = [string]$lock.version
        commit = [string]$lock.commit
        tarballSHA256 = [string]$lock.tarballSHA256
        source = if ($fromSource) { 'source' } elseif ($localTarball -and $lock.sourceMode -eq 'development-source') { 'development-source' } elseif ($localTarball) { 'locked-tarball' } else { 'npm' }
    }
}
