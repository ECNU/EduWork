[CmdletBinding()]
param(
    [string]$Upstream = (Join-Path $PSScriptRoot '..\..\.research\upstream\deepseek-harness'),
    [string]$RuntimePackages = '',
    [string]$DshLockPath = '',
    [string]$Output = '',
    [string]$Version = '0.1.0-dev'
)

$ErrorActionPreference = 'Stop'
$upstream = [IO.Path]::GetFullPath($Upstream)
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($DshLockPath)) { $DshLockPath = Join-Path $repository 'third_party\dsh\LOCK.json' }
$lock = Get-Content -Raw -LiteralPath $DshLockPath | ConvertFrom-Json
$source = if ([string]::IsNullOrWhiteSpace($RuntimePackages)) {
    & (Join-Path $repository 'dsh-desktop\scripts\test-dsh-compatibility.ps1') -Upstream $upstream -LockPath $DshLockPath
    Join-Path $upstream 'packages\client\ui-conversation\lib'
} else {
    $runtimePackage = Join-Path ([IO.Path]::GetFullPath($RuntimePackages)) '@deepseek-ai\dsh-client-ui-conversation'
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $runtimePackage 'package.json') | ConvertFrom-Json
    if ([string]$manifest.version -ne [string]$lock.packageVersion) {
        throw "Official DSH Conversation package version mismatch: expected $($lock.packageVersion), got $($manifest.version)"
    }
    Join-Path $runtimePackage 'lib'
}
$target = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $PSScriptRoot 'lib' } else { [IO.Path]::GetFullPath($Output) }
if (-not $target.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Conversation output must stay within the repository' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'client.js'))) {
    throw "Locked DSH Conversation build is unavailable: $source"
}
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($artifact in @('index.js', 'client.js')) {
    Copy-Item -LiteralPath (Join-Path $source $artifact) -Destination (Join-Path $target $artifact)
}

$upstreamPackage = '@deepseek-ai/dsh-client-ui-conversation'
$productPackage = '@chatecnu-work/dsh-client-ui-conversation-brand'
foreach ($artifact in @('client.js')) {
    $artifactPath = Join-Path $target $artifact
    $artifactText = [IO.File]::ReadAllText($artifactPath)
    $identityCount = ([regex]::Matches($artifactText, [regex]::Escape($upstreamPackage))).Count
    if ($identityCount -lt 1) {
        throw "Conversation package identity anchor changed: $artifact ($identityCount matches)"
    }
    $artifactText = $artifactText.Replace($upstreamPackage, $productPackage)
    [IO.File]::WriteAllText($artifactPath, $artifactText, [Text.UTF8Encoding]::new($false))
}

$clientPath = Join-Path $target 'client.js'
$client = [IO.File]::ReadAllText($clientPath)
$previousEncoding = [Console]::OutputEncoding
try {
    # Node emits UTF-8 JSON. A fresh background PowerShell may still use CP936.
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $releaseIdentity = & node (Join-Path $repository 'dsh-host/release-policy.mjs') $Version ([string]$lock.packageVersion) | ConvertFrom-Json
} finally { [Console]::OutputEncoding = $previousEncoding }
if ($LASTEXITCODE -ne 0) { throw 'Invalid product release identity' }
$previewBadge = $releaseIdentity.badge.zh
$replacements = [ordered]@{
    '"hero.headline": "探索未至之境"' = '"hero.headline": "今天想一起完成什么？"'
    '"hero.preview": "预览版"' = '"hero.preview": "' + $previewBadge + '"'
    '"hero.headline": "Into the Unknown"' = '"hero.headline": "What shall we accomplish today?"'
    '"hero.preview": "Preview"' = '"hero.preview": "' + $releaseIdentity.badge.en + '"'
}
foreach ($entry in $replacements.GetEnumerator()) {
    $count = ([regex]::Matches($client, [regex]::Escape($entry.Key))).Count
    if ($count -ne 1) { throw "Conversation copy compatibility anchor changed: $($entry.Key) ($count matches)" }
    $client = $client.Replace($entry.Key, $entry.Value)
}

# The build policy supplies a development/public-beta/release badge while
# preserving the locked upstream DOM and the optional empty-label behavior.
# 0.1.5 keeps the same hero node but emits adjacent JSX children on one line.
# Anchor the unique previewBadge node rather than bundler indentation.
$badgePattern = '\(0, react_jsx_runtime\.jsx\)\("span", \{\s*className: HeroShell_module_css_default\.previewBadge,\s*children: t\("hero\.preview"\)\s*\}\)'
$badgeMatches = [regex]::Matches($client, $badgePattern)
if ($badgeMatches.Count -ne 1) { throw "Conversation hero badge compatibility anchor changed ($($badgeMatches.Count) matches)" }
$badge = $badgeMatches[0]
$productBadge = $badge.Value.Replace(
    '(0, react_jsx_runtime.jsx)("span", {',
    't("hero.preview") === "" ? null : (0, react_jsx_runtime.jsx)("span", {'
)
$client = $client.Remove($badge.Index, $badge.Length).Insert($badge.Index, $productBadge)

# DSH 0.1.3 provides native generic-file intake. Do not install the legacy
# add-control override or its document-level drop handler on that runtime.
$nativeFileIntake = [string]$lock.packageVersion -notmatch '^0\.1\.[012](?:-|$)'
if (-not $nativeFileIntake) {
# Older DSH exposes the resident plus button only as a command-menu launcher,
# while its attachment surface accepts images only. Replace that one resident
# control with a single product child seat: the product file plugin can offer
# ordinary workspace import and then hand images/commands straight back to
# the locked Conversation intake. Without a registrant, the official control
# remains the fallback.
$attachmentChildPattern = '(?m)^(?<indent>\t*)"conversation\.input\.attachments": \{\r?\n\k<indent>\tkind: "single",\r?\n\k<indent>\tscope: "session-maybe"\r?\n\k<indent>\},'
$attachmentChildMatches = [regex]::Matches($client, $attachmentChildPattern)
if ($attachmentChildMatches.Count -ne 1) { throw "Conversation add-control child anchor changed ($($attachmentChildMatches.Count) matches)" }
$attachmentChildMatch = $attachmentChildMatches[0]
$childIndent = $attachmentChildMatch.Groups['indent'].Value
$addChild = "`n" + $childIndent + '"conversation.input.add": {' + "`n" + $childIndent + "`t" + 'kind: "single",' + "`n" + $childIndent + "`t" + 'scope: "session-maybe"' + "`n" + $childIndent + '},'
$client = $client.Insert($attachmentChildMatch.Index + $attachmentChildMatch.Length, $addChild)

$nativeAddPattern = '(?ms)\(0, react_jsx_runtime\.jsx\)\(_deepseek_ai_dsh_client_ui_primitives\.Tooltip, \{\s*label: t\("input\.commands"\),.*?\}\)(?=,\s*\(0, react_jsx_runtime\.jsxs\)\("div", \{\s*className: InputBar_module_css_default\.modes)'
$nativeAddMatches = [regex]::Matches($client, $nativeAddPattern)
if ($nativeAddMatches.Count -ne 1) { throw "Conversation native add-control anchor changed ($($nativeAddMatches.Count) matches)" }
$nativeAdd = $nativeAddMatches[0]
$productAdd = 'renderSlot("conversation.input.add", {' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'sessionId,' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'input,' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'inputActions,' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'locked,' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'onAddImages: intakeImages,' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'insertReference: (reference) => {' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t`t" + 'const snapshot = keyboard?.snapshot;' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t`t" + 'if (snapshot === undefined || typeof keyboard?.insertReference !== "function") return false;' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t`t" + 'const span = keyboard.caretSpan();' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t`t" + 'return keyboard.insertReference(reference, { ...span, draftRev: snapshot.draftRev });' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + '},' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'openCommands: onToggleCommandMenu,' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'commandMenuOpen,' + "`n" +
    "`t`t`t`t`t`t`t`t`t`t" + 'notify: showToast' + "`n" +
    "`t`t`t`t`t`t`t`t`t" + '}) ?? ' + $nativeAdd.Value
$client = $client.Remove($nativeAdd.Index, $nativeAdd.Length).Insert($nativeAdd.Index, $productAdd)
$addSlotDeclarationPattern = '(?m)^\s*"conversation\.input\.add": \{\s*$'
$addSlotDeclarationCount = ([regex]::Matches($client, $addSlotDeclarationPattern)).Count
if ($addSlotDeclarationCount -ne 1) { throw "Conversation add-control must have exactly one child declaration ($addSlotDeclarationCount found)" }
} elseif (-not $client.Contains('onAddFiles: intakeFiles')) {
    throw 'Expected native generic-file intake is missing from this DSH build'
}
[IO.File]::WriteAllText($clientPath, $client, [Text.UTF8Encoding]::new($false))
& (Join-Path $PSScriptRoot '..\..\scripts\normalize-generated-client.ps1') -Path $target
Write-Host 'Built ChatECNU Work Conversation derivative with product copy and unified add-control seat.'
