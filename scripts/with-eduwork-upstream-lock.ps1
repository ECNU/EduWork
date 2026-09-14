#Requires -Version 7.0
# Client builders temporarily stage packages inside the shared official source
# tree. All supported preparation/assembly entry points use the same lock.
function Invoke-WithEduworkUpstreamLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Upstream,
        [Parameter(Mandatory)][scriptblock]$Action,
        [string]$Activity = 'DSH build'
    )
    $normalized = [IO.Path]::GetFullPath($Upstream).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if ($IsWindows) { $normalized = $normalized.Replace('/', '\').ToUpperInvariant() }
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($normalized)))
    $name = 'EduWork.Upstream.' + $digest
    # Global also coordinates separate Windows sessions using this source tree.
    if ($IsWindows) { $name = 'Global\' + $name }
    $mutex = [Threading.Mutex]::new($false, $name)
    $owned = $false
    try {
        try { $owned = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] {
            $owned = $true
            Write-Host "Recovered source build lock after a stopped process: $Activity"
        }
        if (-not $owned) { Write-Host "Waiting for shared source build lock: $Activity" }
        while (-not $owned) {
            try { $owned = $mutex.WaitOne(30000) }
            catch [Threading.AbandonedMutexException] {
                $owned = $true
                Write-Host "Recovered source build lock after a stopped process: $Activity"
            }
            if (-not $owned) { Write-Host "Still waiting for shared source build lock: $Activity" }
        }
        & $Action
    } finally {
        if ($owned) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
