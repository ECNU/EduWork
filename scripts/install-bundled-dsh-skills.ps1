# Shared desktop/Web skill projection, including the pinned older npm baseline.
function Resolve-DshSkillChild([string]$Root, [string]$Relative) {
    if ([string]::IsNullOrWhiteSpace($Relative) -or [IO.Path]::IsPathRooted($Relative) -or ($Relative -split '[/\\]') -contains '..') { throw 'Skill source must stay inside its configured root' }
    $separator = [IO.Path]::DirectorySeparatorChar
    $parent = [IO.Path]::GetFullPath($Root).TrimEnd($separator, [IO.Path]::AltDirectorySeparatorChar)
    $path = [IO.Path]::GetFullPath((Join-Path $parent $Relative))
    if (-not $path.StartsWith($parent + $separator, [StringComparison]::OrdinalIgnoreCase)) { throw 'Skill source escapes its configured root' }
    return $path
}

function Get-DshSkillCapabilities([string]$PackageRoot) {
    $shared = Join-Path $PackageRoot '@eduwork/dsh-artifact-services'
    $studio = Join-Path $PackageRoot '@eduwork/dsh-knowledge-studio/package.json'
    $manifest = if (Test-Path -LiteralPath $studio) { Get-Content -LiteralPath $studio -Raw | ConvertFrom-Json } else { $null }
    return [pscustomobject]@{
        imageGeneration = (Test-Path -LiteralPath (Join-Path $shared 'lib/images.js')) -and (Test-Path -LiteralPath (Join-Path $shared 'skills/images/SKILL.md'))
        configurableStudioSkills = @($manifest.dshKnowledgeStudio.capabilities) -contains 'configurableSkills'
    }
}

function Copy-DshBundledSkills([string]$Repository, [string]$PackageRoot, [string]$SkillRoot, [object[]]$Skills) {
    $capabilities = Get-DshSkillCapabilities -PackageRoot $PackageRoot
    foreach ($skill in $Skills) {
        if ($skill.requiresPackageCapability) {
            if ($skill.requiresPackageCapability -ne 'configurableSkills') { throw 'Unknown package skill capability' }
            if (-not $capabilities.configurableStudioSkills) { continue }
        }
        $source = if ($skill.sourcePackage) {
            $package = Resolve-DshSkillChild $PackageRoot $skill.sourcePackage
            Resolve-DshSkillChild $package $skill.sourcePath
        } else { Resolve-DshSkillChild $Repository $skill.source }
        $fallback = $false
        if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) {
            if (-not $skill.fallback.source) { throw "Selected bundled Skill is missing SKILL.md: $source" }
            $source = Resolve-DshSkillChild $Repository $skill.fallback.source
            $fallback = $true
        }
        if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) { throw "Fallback Skill is missing SKILL.md: $source" }
        $target = Resolve-DshSkillChild $SkillRoot $skill.name
        if (Test-Path -LiteralPath $target) { throw "Skill target already exists in this assembly: $target" }
        New-Item -ItemType Directory -Path $SkillRoot -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target -Recurse
        if ($fallback) {
            $path = Join-Path $target 'SKILL.md'
            $content = Get-Content -LiteralPath $path -Raw
            $content = [regex]::Replace($content, '(?m)^name: .+$', ('name: ' + $skill.name))
            Set-Content -LiteralPath $path -Value $content -Encoding utf8NoBOM
        }
        if ($skill.metadata) {
            # Edition metadata changes the binding, never duplicates the Skill's instructions.
            # Older production recipes keep their original metadata and credentials contract.
            $projectMetadata = @'
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const [file, packages, metadata] = process.argv.slice(1);
const yaml = createRequire(resolve(packages, '../package.json'))('yaml');
const body = readFileSync(file, 'utf8');
const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
if (!header) throw new Error('Skill metadata projection requires YAML frontmatter');
const value = yaml.parse(header[1]);
value.metadata = JSON.parse(metadata);
writeFileSync(file, '---\n' + yaml.stringify(value) + '---' + body.slice(header[0].length));
'@
            $taskNode = (Get-Command node -ErrorAction Stop).Source
            & $taskNode --input-type=module -e $projectMetadata (Join-Path $target 'SKILL.md') $PackageRoot ($skill.metadata | ConvertTo-Json -Compress -Depth 20)
            if ($LASTEXITCODE -ne 0) { throw "Skill metadata projection failed: $($skill.name)" }
        }
        Write-Output ([string]$skill.name)
    }
    # Shared creation guidance is read both by the Studio planner and by the
    # projected file skills. Preserve their sibling reference paths without
    # registering the reference directory as another user-facing skill.
    if (@($Skills | ForEach-Object { $_.sourcePackage }) -contains '@eduwork/dsh-artifact-services') {
        $sharedPackage = Resolve-DshSkillChild $PackageRoot '@eduwork/dsh-artifact-services'
        $references = Resolve-DshSkillChild $sharedPackage 'skills/shared'
        if (Test-Path -LiteralPath $references -PathType Container) {
            if (@(Get-ChildItem -LiteralPath $references -Recurse -File -Filter SKILL.md).Count) { throw 'Shared references must not register another Skill' }
            $referenceTarget = Resolve-DshSkillChild $SkillRoot 'shared'
            if (Test-Path -LiteralPath $referenceTarget) { throw "Shared Skill references already exist: $referenceTarget" }
            Copy-Item -LiteralPath $references -Destination $referenceTarget -Recurse
        }
    }
}

function Set-DshMediaCompatibility([string]$PatchPath, [object]$Capabilities) {
    if ($Capabilities.imageGeneration -or -not (Test-Path -LiteralPath $PatchPath)) { return }
    $text = (Get-Content -LiteralPath $PatchPath -Raw).Replace("`r`n", "`n")
    $pattern = "(?m)(^(?<indent>[ `t]*)name: '@chatecnu-work/dsh-tool-ecnu-media'`n\k<indent>config:`n)"
    $text = [regex]::Replace($text, $pattern, { param($match) $match.Value + $match.Groups['indent'].Value + "  legacyTools: true`n" })
    Set-Content -LiteralPath $PatchPath -Value $text -Encoding utf8NoBOM
}
