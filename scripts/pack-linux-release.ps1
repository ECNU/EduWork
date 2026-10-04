#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Candidate, [Parameter(Mandatory)][string]$Output, [switch]$Development)
$ErrorActionPreference = 'Stop'
$Candidate = (Resolve-Path -LiteralPath $Candidate).Path
$Output = [IO.Path]::GetFullPath($Output)
if ($Output.StartsWith($Candidate.TrimEnd('/') + '/', [StringComparison]::Ordinal) -or (Test-Path -LiteralPath $Output)) { throw 'Archive must be a new file outside the desktop directory' }
$identity = Get-Content (Join-Path $Candidate 'resources/app/eduwork.desktop.json') -Raw | ConvertFrom-Json
$release = & node (Join-Path $PSScriptRoot 'desktop-build-plan.mjs') --identity --version $identity.productVersion
if ($LASTEXITCODE -ne 0) { throw 'Unsupported desktop release version' }
$release = $release | ConvertFrom-Json
if ([bool]$Development -ne $release.prerelease -or $identity.shell -ne 'electron') { throw 'Package version does not match its selected channel or Electron shell' }
$name = switch ($identity.distribution) { 'eduwork' { 'EduWork' } 'eduwork-chatecnu' { 'EduWork-ECNU' } default { throw 'Unknown release distribution' } }
if ([IO.Path]::GetFileName($Output) -ne "$name-$($identity.productVersion)-linux-x64-electron.tar.gz") { throw 'Release asset name differs from the package identity' }
if (-not (Test-Path -LiteralPath (Join-Path $Candidate 'eduwork') -PathType Leaf)) { throw 'Linux launcher is missing' }
$files = [Collections.Generic.List[object]]::new()
function Inventory([string]$Directory, [string]$Prefix) {
    foreach ($entry in Get-ChildItem -LiteralPath $Directory -Force) {
        $relative = if ($Prefix) { "$Prefix/$($entry.Name)" } else { $entry.Name }
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            $target = [string]@($entry.Target)[0]
            $resolved = (Resolve-Path -LiteralPath $entry.FullName).Path
            $inside = $resolved.Equals($Candidate, [StringComparison]::Ordinal) -or $resolved.StartsWith($Candidate.TrimEnd('/') + '/', [StringComparison]::Ordinal)
            if ($entry.LinkType -ne 'SymbolicLink' -or [IO.Path]::IsPathRooted($target) -or -not $inside) { throw "Unresolved package link: $relative" }
            $files.Add(@{ path = $relative; link = $target })
            continue
        }
        if ($relative -match '(^|/)(\.git|\.env|\.env\.local|credentials\.encrypted)(/|$)' -or $relative -match '^(data|evidence)(/|$)') { throw "Private/build data in the release: $relative" }
        if ($entry.PSIsContainer) { Inventory $entry.FullName $relative }
        else {
            if ($relative -match '^(config/|resources/product/resources/desktop/)' -and $entry.Extension -in @('.json', '.jsonc')) {
                $text = [IO.File]::ReadAllText($entry.FullName)
                foreach ($match in [regex]::Matches($text, '"client(?:Id|ID|_id)"\s*:\s*"([^"]+)"')) {
                    if ($match.Groups[1].Value -notmatch '^replace-with-[a-z0-9-]+$') { throw "Deployment client identifier in public package configuration: $relative" }
                }
            }
            $files.Add(@{ path = $relative; bytes = $entry.Length; sha256 = (Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant() })
        }
    }
}
Inventory $Candidate ''
$manifest = @{ schemaVersion = 1; kind = 'eduwork-linux-release'; version = $identity.productVersion; distribution = $identity.distribution; shell = 'electron'; platform = 'linux-x64'; launch = 'eduwork'; files = @($files.ToArray()) }
$manifestPath = Join-Path $Candidate 'RELEASE-MANIFEST.json'
if (Test-Path -LiteralPath $manifestPath) { throw 'Candidate already contains a release manifest' }
try {
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
    New-Item -ItemType Directory -Path (Split-Path $Output -Parent) -Force | Out-Null
    & tar -C $Candidate --transform "s,^\./,$name/," -czf $Output .
    if ($LASTEXITCODE -ne 0) { throw 'Linux archive creation failed' }
} finally {
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
}
$hash = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($Output))" | Set-Content -LiteralPath ($Output + '.sha256') -Encoding utf8NoBOM
Write-Host "Created $([IO.Path]::GetFileName($Output)): $((Get-Item $Output).Length) bytes, SHA256 $hash"
