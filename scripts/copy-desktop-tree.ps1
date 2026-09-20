#Requires -Version 7.0
function Copy-Tree([string]$Source,[string]$Destination) {
    $sourceItem = Get-Item -LiteralPath $Source -Force
    if (-not $sourceItem.PSIsContainer -or $sourceItem.LinkType) { throw "Desktop copy source must be a real directory: $Source" }
    if (-not $IsWindows) {
        if (Test-Path -LiteralPath $Destination) {
            $destinationItem = Get-Item -LiteralPath $Destination -Force
            if (-not $destinationItem.PSIsContainer -or $destinationItem.LinkType) { throw "Desktop copy destination must be a real directory: $Destination" }
        } else { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }
        foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
            if ($item.LinkType) { throw "Desktop copy does not follow links: $($item.FullName)" }
            $target = Join-Path $Destination $item.Name
            if ($item.PSIsContainer) { Copy-Tree $item.FullName $target }
            else {
                if (Test-Path -LiteralPath $target) {
                    $existing = Get-Item -LiteralPath $target -Force
                    if ($existing.PSIsContainer -or $existing.LinkType) { throw "Desktop copy target must be a real file: $target" }
                }
                Copy-Item -LiteralPath $item.FullName -Destination $target -Force
            }
        }
        return
    }
    $nativeErrors = $PSNativeCommandUseErrorActionPreference
    try {
        $PSNativeCommandUseErrorActionPreference = $false
        & robocopy.exe $Source $Destination /E /XJ /COPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw 'Desktop payload copy failed' }
        $global:LASTEXITCODE = 0
    } finally { $PSNativeCommandUseErrorActionPreference = $nativeErrors }
}
