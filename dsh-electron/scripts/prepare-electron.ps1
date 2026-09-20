#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Upstream, [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$package = Join-Path $Upstream 'apps/desktop/node_modules/electron'
$manifest = Get-Content -LiteralPath (Join-Path $package 'package.json') -Raw | ConvertFrom-Json
$checksums = Get-Content -LiteralPath (Join-Path $package 'checksums.json') -Raw | ConvertFrom-Json
$platform = if ($IsWindows) { 'win32' } elseif ($IsMacOS) { 'darwin' } else { throw 'Electron preparation supports Windows and macOS only' }
$arch = (& node -p 'process.arch').Trim()
if ($LASTEXITCODE -ne 0 -or $arch -notin @('x64','arm64')) { throw 'Electron preparation requires Node x64 or arm64' }
$archiveName = "electron-v$($manifest.version)-$platform-$arch.zip"
$expected = $checksums.$archiveName
if ($expected -notmatch '^[a-f0-9]{64}$') { throw "The pinned Electron package has no $platform $arch checksum" }
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $Output -Force | Out-Null
$archive = Join-Path $Output $archiveName
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri "https://github.com/electron/electron/releases/download/v$($manifest.version)/$archiveName" -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Electron archive checksum mismatch' }
$runtime = Join-Path $Output 'runtime'
if (-not (Test-Path -LiteralPath $runtime -PathType Container)) {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    & tar -xf $archive -C $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Electron extraction failed' }
}
if ($IsWindows) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtime 'electron.exe') -PathType Leaf)) { throw 'Electron runtime executable is missing' }
    $actualVersion = (Get-Content -LiteralPath (Join-Path $runtime 'version') -Raw).Trim().TrimStart('v')
    $actualArch = $arch # Windows runtime architecture is bound to the verified archive.
} else {
    $electronApp = Join-Path $runtime 'Electron.app'
    $executable = Join-Path $electronApp 'Contents/MacOS/Electron'
    $plist = Join-Path $electronApp 'Contents/Info.plist'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or -not (Test-Path -LiteralPath $plist -PathType Leaf)) { throw 'Electron.app runtime is incomplete' }
    $actualVersion = (& plutil -extract CFBundleShortVersionString raw $plist).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Electron.app version could not be read' }
    $architectures = (& lipo -archs $executable).Trim() -split '\s+'
    if ($LASTEXITCODE -ne 0 -or $arch -notin $architectures) { throw "Electron runtime architecture mismatch: expected $arch" }
    $actualArch = $arch
}
if ($actualVersion -ne $manifest.version) { throw "Electron runtime version mismatch: expected $($manifest.version), found $actualVersion" }
@{version=$actualVersion;platform=$platform;arch=$actualArch;archive=$archiveName;sha256=$expected;downloadedFrom='https://github.com/electron/electron/releases';runtime=$runtime} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'receipt.json') -Encoding utf8NoBOM
Write-Output "Verified Electron $actualVersion $platform $actualArch runtime: $runtime"
