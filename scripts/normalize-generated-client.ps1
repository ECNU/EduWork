[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string[]]$Path
)

$ErrorActionPreference = 'Stop'

function Resolve-JavaScriptFiles {
    param([string]$InputPath)

    $resolved = Resolve-Path -LiteralPath $InputPath -ErrorAction Stop
    if ((Get-Item -LiteralPath $resolved.Path).PSIsContainer) {
        return Get-ChildItem -LiteralPath $resolved.Path -Filter '*.js' -File -Recurse
    }
    return Get-Item -LiteralPath $resolved.Path
}

$files = foreach ($inputPath in $Path) {
    Resolve-JavaScriptFiles -InputPath $inputPath
}

foreach ($file in $files | Sort-Object -Property FullName -Unique) {
    $original = [IO.File]::ReadAllText(
        $file.FullName,
        [Text.UTF8Encoding]::new($false, $true)
    )
    $content = $original

    # Bundlers may retain the absolute checkout path in region comments. Keep
    # the upstream provenance while making committed artifacts reproducible and
    # safe to publish from any developer machine.
    $content = $content -replace '(?i)[A-Z]:\\[^\r\n]*?\\\.research\\upstream\\deepseek-harness(?:-[^\\]+)?\\', '<dsh-upstream>\\'
    # Official Linux CI also emits region provenance. Restrict normalization to
    # these comments, preserving executable strings and license attribution.
    $content = $content -replace '(?m)^(\s*//[#]?\s*region\s+(?:\\0dsh-css:)?)/home/runner/work/deepseek-harness/deepseek-harness/', '$1<dsh-upstream>/'
    $content = $content -replace '(?mi)^(\s*//[#]?\s*region\s+(?:\\0dsh-css:)?)[A-Z]:[\\/][^\r\n]*?[\\/]eduwork-dsh-[a-f0-9]{12}[\\/]', '$1<dsh-upstream>/'
    $content = $content -replace '(?m)^//# sourceMappingURL=.*?\s*$', ''
    $content = $content -replace '(?m)[ \t]+(?=\r?$)', ''
    $content = $content.TrimEnd("`r", "`n") + "`n"

    if ($content -cne $original) {
        [IO.File]::WriteAllText(
            $file.FullName,
            $content,
            [Text.UTF8Encoding]::new($false)
        )
    }
}
