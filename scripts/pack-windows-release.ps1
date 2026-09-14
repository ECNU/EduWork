#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Candidate, [Parameter(Mandatory)][string]$Output,
    [switch]$Development, [switch]$ForUpdate)
$ErrorActionPreference = 'Stop'
$Candidate = (Resolve-Path -LiteralPath $Candidate).Path
$Output = [IO.Path]::GetFullPath($Output)
if ($Output.StartsWith($Candidate.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $Output)) { throw 'ZIP must be a new file outside the desktop directory' }
$identity = Get-Content (Join-Path $Candidate 'resources/app/eduwork.desktop.json') -Raw | ConvertFrom-Json
$versionPattern = if ($Development) { '^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$' } else { '^\d+\.\d+\.\d+$' }
if ($identity.productVersion -notmatch $versionPattern -or $identity.shell -ne 'electron') { throw 'Package version does not match its selected channel or Electron shell' }
if ($ForUpdate) {
    foreach ($entry in @('ChatECNU-Work.exe','EduWork.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Candidate $entry) -PathType Leaf)) { throw "Migration launcher is missing: $entry" }
    }
}
$name = switch ($identity.distribution) { 'eduwork' {'EduWork'} 'eduwork-chatecnu' {'EduWork-ECNU'} default {throw 'Unknown release distribution'} }
if ([IO.Path]::GetFileName($Output) -ne "$name-$($identity.productVersion)-windows-x64-electron.zip") { throw 'Release asset name differs from the package identity' }
$files = [Collections.Generic.List[object]]::new()
function Inventory([string]$Directory, [string]$Prefix) {
    foreach ($entry in Get-ChildItem -LiteralPath $Directory -Force) {
        $relative = if ($Prefix) { "$Prefix/$($entry.Name)" } else { $entry.Name }
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Unresolved package link: $relative" }
        if ($relative -match '(^|/)(\.git|\.env|\.env\.local|credentials\.encrypted)(/|$)' -or $relative -match '^(data|evidence)(/|$)') { throw "Private/build data in the release: $relative" }
        if ($entry.PSIsContainer) { Inventory $entry.FullName $relative }
        else {
            if ($relative -match '^(config/|resources/product/resources/desktop/)' -and $entry.Extension -in @('.json', '.jsonc')) {
                $text = [IO.File]::ReadAllText($entry.FullName)
                foreach ($match in [regex]::Matches($text, '"client(?:Id|ID|_id)"\s*:\s*"([^"]+)"')) {
                    if ($match.Groups[1].Value -notmatch '^replace-with-[a-z0-9-]+$') { throw "Deployment client identifier in public package configuration: $relative" }
                }
            }
            $files.Add(@{path=$relative;bytes=$entry.Length;sha256=(Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()})
        }
    }
}
Inventory $Candidate ''
New-Item -ItemType Directory -Path (Split-Path $Output -Parent) -Force | Out-Null
$stream = [IO.File]::Open($Output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
$zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in $files) {
        $entry=$zip.CreateEntry("$name/$($file.path)",[IO.Compression.CompressionLevel]::Optimal)
        $destination=$entry.Open(); $source=[IO.File]::OpenRead((Join-Path $Candidate $file.path))
        try {$source.CopyTo($destination)} finally {$source.Dispose();$destination.Dispose()}
    }
    $entry=$zip.CreateEntry("$name/RELEASE-MANIFEST.json"); $destination=$entry.Open()
    try {
        $manifest=@{schemaVersion=1;kind='eduwork-portable-release';version=$identity.productVersion;distribution=$identity.distribution;shell='electron';platform='windows-x64';files=@($files.ToArray())}
        if ($ForUpdate) {
            $manifest.launcherVersion=$identity.productVersion
            $manifest.flavor='offline'
            $manifest.launch=@{protocol='eduwork-desktop/v1';shell='electron';executable='EduWork-Electron.exe';migration='wails-host-v1';distribution=$identity.distribution}
        }
        $bytes=[Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 8)); $destination.Write($bytes)
    } finally {$destination.Dispose()}
} finally {$zip.Dispose();$stream.Dispose()}
$hash=(Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($Output))" | Set-Content -LiteralPath ($Output+'.sha256') -Encoding utf8NoBOM
Write-Host "Created $([IO.Path]::GetFileName($Output)): $((Get-Item $Output).Length) bytes, SHA256 $hash"
