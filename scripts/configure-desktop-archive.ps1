#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSHA256,
    [Parameter(Mandatory)][string]$Config,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$Archive = (Resolve-Path -LiteralPath $Archive).Path
$Config = (Resolve-Path -LiteralPath $Config).Path
$Output = [IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $Output) { throw 'Output already exists; keep the CI archive immutable.' }
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $ExpectedSHA256) { throw 'CI archive SHA-256 mismatch.' }
$validation = & node (Join-Path $PSScriptRoot 'validate-distribution-config.mjs') $Config
if ($LASTEXITCODE) { throw 'Institution configuration validation failed.' }
$configSummary = $validation | ConvertFrom-Json
$configBytes = [IO.File]::ReadAllBytes($Config)
$configHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($configBytes)).ToLowerInvariant()

function Read-EntryText($Entry) {
    $reader = [IO.StreamReader]::new($Entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Check-Archive([string]$Path) {
    $zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entries = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -match '(^/|\\|:|(^|/)\.\.?(/|$))' -or (($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000) { throw 'Unsafe archive path or filesystem link.' }
            if (-not $entries.TryAdd($entry.FullName, $entry)) { throw 'Duplicate archive entry.' }
        }
        $roots = @($zip.Entries | Where-Object FullName -match '^[^/]+/RELEASE-MANIFEST.json$')
        if ($roots.Count -ne 1) { throw 'Expected one desktop release manifest.' }
        $prefix = $roots[0].FullName -replace 'RELEASE-MANIFEST.json$', ''
        $manifest = Read-EntryText $roots[0] | ConvertFrom-Json
        if ($manifest.schemaVersion -ne 1) { throw 'Unsupported desktop archive.' }
        if ($manifest.launch) {
            if ($manifest.launch.shell -ne 'electron' -or $manifest.launch.protocol -ne 'eduwork-desktop/v1') { throw 'Unsupported update archive.' }
            $version = $manifest.launcherVersion; $distribution = $manifest.launch.distribution
        } else {
            if ($manifest.kind -ne 'eduwork-portable-release' -or $manifest.shell -ne 'electron') { throw 'Unsupported portable archive.' }
            $version = $manifest.version; $distribution = $manifest.distribution
        }
        $files = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($file in $manifest.files) {
            if ($file.path -match '(^/|\\|:|(^|/)\.\.?(/|$)|^data/)' -or -not $files.TryAdd($file.path, $file)) { throw 'Invalid or duplicate manifest path.' }
            $entry = $entries[$prefix + $file.path]
            if (-not $entry -or $entry.Length -ne $file.bytes) { throw "Missing file or size mismatch: $($file.path)" }
            $stream = $entry.Open()
            try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() } finally { $stream.Dispose() }
            if ($hash -ne $file.sha256) { throw "File digest mismatch: $($file.path)" }
        }
        if (@($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') }).Count -ne $files.Count + 1) { throw 'Archive contains unlisted files.' }
        $identityEntry = $entries[$prefix + 'resources/app/eduwork.desktop.json']
        if (-not $identityEntry -or -not $files.ContainsKey('config/eduwork.jsonc')) { throw 'Desktop identity or config is missing.' }
        $identity = Read-EntryText $identityEntry | ConvertFrom-Json
        if ($identity.shell -ne 'electron' -or $identity.productVersion -ne $version -or $identity.distribution -ne $distribution) { throw 'Desktop identity mismatch.' }
        return @{prefix=$prefix;manifest=$manifest;files=$files;identity=$identity}
    } finally { $zip.Dispose() }
}

$source = Check-Archive $Archive
$configPaths = @('config/eduwork.jsonc')
if ($source.identity.configurationOwnership -eq 'publisher') {
    $versionedConfig = "config/eduwork.$($source.identity.productVersion).jsonc"
    if (-not $source.files.ContainsKey($versionedConfig)) { throw 'Publisher configuration template is missing from the CI archive.' }
    $configPaths += $versionedConfig
} elseif ($source.identity.configurationOwnership -and $source.identity.configurationOwnership -ne 'user') { throw 'Unknown configuration ownership policy.' }
$expectedPolicy = if ($source.identity.productVersion -match '-dev\.') {'development'} else {'stable'}
if ($configSummary.defaultPolicy -and $configSummary.defaultPolicy -ne $expectedPolicy) { throw 'Configuration update policy differs from the CI version channel.' }
New-Item -ItemType Directory -Path (Split-Path $Output) -Force | Out-Null
$partial = $Output + '.' + [Guid]::NewGuid().ToString('N') + '.partial'
try {
    Copy-Item -LiteralPath $Archive -Destination $partial
    $zip = [IO.Compression.ZipFile]::Open($partial, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $replacements = @{}
        foreach ($configPath in $configPaths) {
            $configFile = $source.files[$configPath]
            $configFile.bytes = $configBytes.LongLength
            $configFile.sha256 = $configHash
            $replacements[$configPath] = $configBytes
        }
        $replacements['RELEASE-MANIFEST.json'] = [Text.Encoding]::UTF8.GetBytes(($source.manifest | ConvertTo-Json -Depth 12))
        foreach ($name in $replacements.Keys) {
            $zip.GetEntry($source.prefix + $name).Delete()
            $entry = $zip.CreateEntry($source.prefix + $name, [IO.Compression.CompressionLevel]::Optimal)
            $stream = $entry.Open()
            try { $stream.Write($replacements[$name]) } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
    $configured = Check-Archive $partial
    if ($configured.files.Count -ne $source.files.Count) { throw 'Archive file set changed.' }
    foreach ($name in $source.files.Keys) {
        if ($name -in $configPaths) { continue }
        if ($configured.files[$name].sha256 -ne $source.files[$name].sha256) { throw "Program file changed: $name" }
    }
    foreach ($configPath in $configPaths) {
        if ($configured.files[$configPath].sha256 -ne $configHash) { throw 'Configuration overlay failed.' }
    }
    Move-Item -LiteralPath $partial -Destination $Output
} finally {
    # Only this invocation's explicitly named temporary file is removable.
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
}
$hash = (Get-FileHash -LiteralPath $Output -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path -Leaf $Output)" | Set-Content -LiteralPath ($Output + '.sha256') -Encoding utf8NoBOM
$receipt = [ordered]@{
    schemaVersion=1; kind='eduwork-configured-desktop'; version=$source.identity.productVersion
    distribution=$source.identity.distribution; sourceCIArchiveSHA256=$ExpectedSHA256.ToLowerInvariant()
    sha256=$hash; bytes=(Get-Item -LiteralPath $Output).Length; programFilesUnchanged=$true
    changedFiles=@($configPaths) + @('RELEASE-MANIFEST.json'); organizations=$configSummary.organizations
    configurationOwnership=$(if ($source.identity.configurationOwnership) {$source.identity.configurationOwnership} else {'user'})
    defaultPolicy=$expectedPolicy; fileCount=$configured.files.Count; publicationStatus='local-only'
}
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ($Output + '.receipt.json') -Encoding utf8NoBOM
$receipt | ConvertTo-Json -Depth 6
