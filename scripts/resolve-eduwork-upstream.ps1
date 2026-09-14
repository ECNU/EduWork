# Shared by Runtime preparation and client compilation. Keep the disposable
# pnpm source tree out of arbitrarily deep user repository paths on Windows.
function Resolve-EduworkUpstream {
    param([Parameter(Mandatory)][string]$Commit, [string]$Upstream = '')
    if ($Commit -notmatch '^[a-f0-9]{40}$') { throw 'An exact DSH source commit is required' }
    if ($Upstream) { return [IO.Path]::GetFullPath($Upstream) }
    $cache = Join-Path ([IO.Path]::GetTempPath()) ('eduwork-dsh-' + $Commit.Substring(0, 12))
    return [IO.Path]::GetFullPath($cache)
}
