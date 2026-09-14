function Copy-DshPackagePayload {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    $Source = [IO.Path]::GetFullPath($Source)
    $Destination = [IO.Path]::GetFullPath($Destination)
    if ((Get-Item -LiteralPath $Source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package source must be a real directory.' }
    if (Test-Path -LiteralPath $Destination) { throw "Package destination already exists: $Destination" }
    $parent = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $stage = [IO.Path]::GetFullPath((Join-Path $parent ('.pack-' + [Guid]::NewGuid().ToString('N'))))
    if (-not $stage.StartsWith([IO.Path]::GetFullPath($parent).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Package staging escapes destination parent.' }
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        Push-Location $Source
        try {
            $packed = & npm.cmd pack --json --ignore-scripts --pack-destination $stage
            if ($LASTEXITCODE -ne 0) { throw "Package packing failed: $Source" }
            $record = @($packed -join "`n" | ConvertFrom-Json)[0]
        } finally { Pop-Location }
        foreach ($file in $record.files) {
            if ([IO.Path]::IsPathRooted($file.path) -or $file.path -split '[/\\]' -contains '..' -or $file.path -match '(^|/)node_modules/') { throw "Invalid package payload: $($file.path)" }
        }
        & tar.exe -xf (Join-Path $stage $record.filename) -C $stage
        if ($LASTEXITCODE -ne 0) { throw 'Package extraction failed.' }
        foreach ($item in Get-ChildItem -LiteralPath (Join-Path $stage 'package') -Recurse -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked package payload: $($item.FullName)" }
        }
        Move-Item -LiteralPath (Join-Path $stage 'package') -Destination $Destination
    } finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
}
