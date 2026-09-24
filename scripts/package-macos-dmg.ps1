#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$App,
    [Parameter(Mandatory)][string]$Output,
    [string]$Python = 'python3'
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
if (-not $IsMacOS) { throw 'DMG packaging requires macOS and Xcode Command Line Tools' }
$App = [IO.Path]::GetFullPath($App)
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'DMG output already exists' }
$workspace = Join-Path ([IO.Path]::GetTempPath()) ('eduwork-dmg-python-' + [guid]::NewGuid().ToString('N') + '.noindex')
try {
    & $Python -m venv $workspace
    $runtime = Join-Path $workspace 'bin/python3'
    & $runtime -m pip install --disable-pip-version-check --only-binary=:all: --require-hashes -r (Join-Path $PSScriptRoot 'macos-dmg/requirements.txt')
    & $runtime (Join-Path $PSScriptRoot 'macos-dmg/package.py') --app $App --output $Output
} finally {
    if (Test-Path -LiteralPath $workspace) { Remove-Item -LiteralPath $workspace -Recurse -Force }
}
