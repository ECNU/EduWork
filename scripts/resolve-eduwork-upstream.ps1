# Shared by Runtime preparation and client compilation. Keep the disposable
# pnpm source tree out of arbitrarily deep user repository paths on Windows.
function Resolve-EduworkUpstream {
    param([Parameter(Mandatory)][string]$Commit, [string]$Upstream = '')
    if ($Commit -notmatch '^[a-f0-9]{40}$') { throw 'An exact DSH source commit is required' }
    if ($Upstream) { return [IO.Path]::GetFullPath($Upstream) }
    $temporaryRoot = [IO.Path]::GetTempPath()
    # macOS /var is a system symlink to /private/var. Resolve only the OS
    # temporary parent before creating our cache; explicit linked sources are
    # still rejected by the build-input validation.
    if ($IsMacOS) {
        $temporaryRoot = (& node -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' $temporaryRoot).Trim()
        if ($LASTEXITCODE) { throw 'Cannot resolve the macOS temporary directory' }
    }
    $cache = Join-Path $temporaryRoot ('eduwork-dsh-' + $Commit.Substring(0, 12))
    return [IO.Path]::GetFullPath($cache)
}
