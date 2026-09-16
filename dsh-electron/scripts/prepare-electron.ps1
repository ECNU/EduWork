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
if (-not (Test-Path -LiteralPath $(if ($IsWindows) { Join-Path $runtime 'electron.exe' } else { Join-Path $runtime 'Electron.app/Contents/MacOS/Electron' }) -PathType Leaf)) {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    & tar -xf $archive -C $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Electron extraction failed' }
}
if ($IsWindows -and (Get-Content -LiteralPath (Join-Path $runtime 'version') -Raw).Trim().TrimStart('v') -ne $manifest.version) { throw 'Electron runtime version mismatch' }
@{version=$manifest.version;platform=$platform;arch=$arch;archive=$archiveName;sha256=$expected;downloadedFrom='https://github.com/electron/electron/releases';runtime=$runtime} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'receipt.json') -Encoding utf8NoBOM
Write-Output "Verified Electron $($manifest.version) $platform $arch runtime: $runtime"
