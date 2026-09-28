#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$App,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$WorkDirectory
)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
if (-not $IsMacOS) { throw 'DMG packaging requires a native macOS runner' }
$App=[IO.Path]::GetFullPath($App);$Output=[IO.Path]::GetFullPath($Output);$WorkDirectory=[IO.Path]::GetFullPath($WorkDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $App 'Contents/Info.plist') -PathType Leaf)) { throw 'A complete signed application is required' }
if ([IO.Path]::GetExtension($Output) -ne '.dmg' -or (Test-Path -LiteralPath $Output) -or (Test-Path -LiteralPath $WorkDirectory)) { throw 'Choose a new DMG and packaging workspace' }
New-Item -ItemType Directory -Path $WorkDirectory | Out-Null
$builder=Join-Path $PSScriptRoot 'macos-dmg'
$venv=Join-Path $WorkDirectory 'venv'
& python3 -m venv $venv | Out-Host
$python=Join-Path $venv 'bin/python3'
& $python -m pip install --disable-pip-version-check --no-cache-dir --only-binary=:all: --require-hashes -r (Join-Path $builder 'requirements.txt') | Out-Host
& $python -B -m unittest discover -s $builder -p 'test_*.py' | Out-Host
& $python (Join-Path $builder 'package.py') --app $App --output $Output | Out-Host

# Validate the final read-only image, using the exact app already verified from
# the ZIP. Dry-run rsync compares file bytes and symlink targets, without writing
# to the mounted image or treating HFS metadata timestamps as product changes.
$mount=Join-Path $WorkDirectory 'mounted'
New-Item -ItemType Directory -Path $mount | Out-Null
$device=$null
try {
    $device=& $python (Join-Path $builder 'volume.py') attach $Output $mount --readonly
    $installed=Join-Path $mount ([IO.Path]::GetFileName($App))
    & codesign --verify --deep --strict $installed | Out-Host
    $differences=@(& rsync --recursive --links --checksum --dry-run --delete --itemize-changes ($App + '/') ($installed + '/'))
    if ($differences.Count) { throw ('DMG application differs from the verified ZIP: ' + ($differences -join '; ')) }
    $shortcut=Get-Item -LiteralPath (Join-Path $mount 'Applications') -Force
    if ($shortcut.LinkTarget -ne '/Applications') { throw 'DMG Applications shortcut is invalid' }
    foreach ($file in @('.DS_Store','.background/background.png')) {
        if (-not (Test-Path -LiteralPath (Join-Path $mount $file) -PathType Leaf)) { throw "DMG window resource missing: $file" }
    }
} finally {
    if ($device) { & $python (Join-Path $builder 'volume.py') detach $device | Out-Host }
}
$sha=(Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
"$sha  $([IO.Path]::GetFileName($Output))" | Set-Content -LiteralPath ($Output + '.sha256') -Encoding utf8NoBOM
return @{
    asset=@{name=[IO.Path]::GetFileName($Output);bytes=(Get-Item -LiteralPath $Output).Length;sha256=$sha}
    checks=@{imageIntegrity='passed';applicationSignature='passed';matchesZipApplication='passed';installationWindow='passed'}
}
