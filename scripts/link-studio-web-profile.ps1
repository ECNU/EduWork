#Requires -Version 7.0
param([Parameter(Mandatory)][string]$Config, [string]$BaseDirectory = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$BaseDirectory = [IO.Path]::GetFullPath($BaseDirectory)
$settings.home = [IO.Path]::GetFullPath($settings.home, $BaseDirectory)
$settings.assembly = [IO.Path]::GetFullPath($settings.assembly, $BaseDirectory)
$profileName = $(if ($settings.profileName) { [string]$settings.profileName } else { 'chatecnu-work-web' })
if ($profileName -notmatch '^[a-z0-9-]+$') { throw 'Invalid Web profile name.' }
$profile = [IO.Path]::GetFullPath((Join-Path $settings.home "profiles/$profileName"))
$modules = Join-Path $profile 'node_modules'
$runtime = [IO.Path]::GetFullPath((Join-Path $settings.assembly 'd/node_modules'))
$identity = Get-Content (Join-Path $settings.assembly 'assembly.json') -Raw | ConvertFrom-Json
# Only mutable module links to the prepared assembly; no source checkout links.
$names = if ($identity.kind -eq 'eduwork-web') { @('@deepseek-ai','@chatecnu-work','@eduwork','@shlv') } else { @('@deepseek-ai','@chatecnu-work') + @($identity.managedPackages.PSObject.Properties.Name) }
$receiptPath = Join-Path $profile '.eduwork-module-links.json'
$receipt = if (Test-Path -LiteralPath $receiptPath) { Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json } else { $null }
$planned = @()
$links = [ordered]@{}
New-Item -ItemType Directory -Force -Path $modules | Out-Null
foreach ($name in $names) {
    $link = [IO.Path]::GetFullPath((Join-Path $modules $name))
    $target = [IO.Path]::GetFullPath((Join-Path $runtime $name))
    if (-not $link.StartsWith($modules + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not $target.StartsWith($runtime + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Profile module path escaped its owner.' }
    if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw "Missing assembled package: $name" }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $link) | Out-Null
    $existing = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.LinkType -ne 'Junction' -or @($existing.Target).Count -ne 1) { throw "Unexpected profile module entry: $name" }
        $previous = [IO.Path]::GetFullPath($existing.Target)
        if ($previous -ne $target) {
            $managed = $identity.kind -eq 'eduwork-web' -and $receipt.schemaVersion -eq 1 -and $receipt.links.$name -eq $previous
            # Adopt pre-receipt links only when they point into another prepared
            # EduWork assembly. Never replace a real package directory or an
            # unrelated junction; unlinking below never traverses its target.
            if (-not $managed -and $identity.kind -eq 'eduwork-web') {
                $previousModules = $previous
                foreach ($segment in ($name -split '[/\\]')) { $previousModules = Split-Path -Parent $previousModules }
                $previousRuntime = Split-Path -Parent $previousModules
                $previousAssembly = Split-Path -Parent $previousRuntime
                $oldIdentity = Join-Path $previousAssembly 'assembly.json'
                $runtimeMarker = Join-Path $previousRuntime '.chatecnu-dsh-runtime.json'
                if ((Split-Path $previousModules -Leaf) -eq 'node_modules' -and (Split-Path $previousRuntime -Leaf) -eq 'd' -and
                    (Test-Path -LiteralPath $oldIdentity -PathType Leaf) -and (Test-Path -LiteralPath $runtimeMarker -PathType Leaf)) {
                    $old = Get-Content -LiteralPath $oldIdentity -Raw | ConvertFrom-Json
                    $marker = Get-Content -LiteralPath $runtimeMarker -Raw | ConvertFrom-Json
                    $managed = $old.kind -eq 'eduwork-web' -and $old.dshCommit -match '^[a-f0-9]{40}$' -and $old.dshVersion -and $old.dshCommit -eq $marker.dshCommit -and $old.dshVersion -eq $marker.dshVersion
                }
            }
            if (-not $managed) { throw "Unmanaged profile module link: $name. Keep its contents and resolve this entry before switching assemblies." }
        }
        if ($previous -eq $target) { $links[$name]=$target; continue }
    }
    $planned += @{link=$link;target=$target;replace=[bool]$existing}
    $links[$name]=$target
}
# Validate the whole set before changing any link, so conflicts do not leave a
# profile half-switched. Persist ownership for later moves and broken targets.
foreach ($entry in $planned) {
    if ($entry.replace) { Remove-Item -LiteralPath $entry.link -Force }
    New-Item -ItemType Junction -Path $entry.link -Target $entry.target | Out-Null
}
if ($identity.kind -eq 'eduwork-web') {
    @{schemaVersion=1;links=$links} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $receiptPath -Encoding utf8NoBOM
}
