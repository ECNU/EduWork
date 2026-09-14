[CmdletBinding()]
param([Parameter(Mandatory)][string]$Output, [string]$DefaultConfig = '')
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../config/desktop'))
if (-not $DefaultConfig) { $DefaultConfig = Join-Path $source 'eduwork.jsonc' }
if (-not (Test-Path -LiteralPath $DefaultConfig -PathType Leaf)) { throw 'The selected default desktop configuration is missing' }
$destination = Join-Path ([IO.Path]::GetFullPath($Output)) 'config'
$brand = Join-Path ([IO.Path]::GetFullPath($Output)) 'resources/brand'
New-Item -ItemType Directory -Path $brand -Force | Out-Null
foreach($asset in @('icon.svg','icon-32.png','icon-256.png','icon.ico','tray-black.png','tray-white.png')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "../assets/eduwork/$asset") -Destination $brand -Force
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
# Examples are release-owned documentation; the active config and user assets are not.
Copy-Item -LiteralPath (Join-Path $source 'examples') -Destination $destination -Recurse -Force
$editionExamples = Join-Path (Split-Path -Parent $DefaultConfig) 'examples'
if ((Test-Path -LiteralPath $editionExamples -PathType Container) -and $editionExamples -ne (Join-Path $source 'examples')) {
    foreach ($example in Get-ChildItem -LiteralPath $editionExamples -File -Filter '*.jsonc') {
        Copy-Item -LiteralPath $example.FullName -Destination (Join-Path $destination 'examples') -Force
    }
}
$config = Join-Path $destination 'eduwork.jsonc'
if (-not (Test-Path -LiteralPath $config)) {
    # Exclusive creation also preserves a file created concurrently by the user.
    $stream = [IO.File]::Open($config, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try { $bytes = [IO.File]::ReadAllBytes($DefaultConfig); $stream.Write($bytes, 0, $bytes.Length) }
    finally { $stream.Dispose() }
}
