[CmdletBinding()]
param(
    [string]$Upstream = (Join-Path $PSScriptRoot '..\..\.research\upstream\deepseek-harness'),
    [string]$RuntimePackages = '',
    [string]$DshLockPath = '',
    [string]$Output = ''
)

$ErrorActionPreference = 'Stop'
$upstream = [IO.Path]::GetFullPath($Upstream)
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($DshLockPath)) { $DshLockPath = Join-Path $repository 'third_party\dsh\LOCK.json' }
$lock = Get-Content -Raw -LiteralPath $DshLockPath | ConvertFrom-Json
$source = if ([string]::IsNullOrWhiteSpace($RuntimePackages)) {
    & (Join-Path $repository 'dsh-desktop\scripts\test-dsh-compatibility.ps1') -Upstream $upstream -LockPath $DshLockPath
    Join-Path $upstream 'packages\client\ui-agent-preset\lib'
} else {
    $runtimePackage = Join-Path ([IO.Path]::GetFullPath($RuntimePackages)) '@deepseek-ai\dsh-client-ui-agent-preset'
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $runtimePackage 'package.json') | ConvertFrom-Json
    if ([string]$manifest.version -ne [string]$lock.packageVersion) {
        throw "Official DSH Agent Presets package version mismatch: expected $($lock.packageVersion), got $($manifest.version)"
    }
    Join-Path $runtimePackage 'lib'
}
$target = if ([string]::IsNullOrWhiteSpace($Output)) { Join-Path $PSScriptRoot 'lib' } else { [IO.Path]::GetFullPath($Output) }
if (-not $target.StartsWith($repository + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Agent preset output must stay within the repository' }
if (-not (Test-Path -LiteralPath (Join-Path $source 'client.js'))) {
    throw "Locked DSH Agent Presets build is unavailable: $source"
}
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($artifact in @('index.js', 'client.js')) {
    Copy-Item -LiteralPath (Join-Path $source $artifact) -Destination (Join-Path $target $artifact)
}

$upstreamPackage = '@deepseek-ai/dsh-client-ui-agent-preset'
$productPackage = '@chatecnu-work/dsh-client-ui-agent-preset-product'
foreach ($artifact in @('client.js')) {
    $artifactPath = Join-Path $target $artifact
    $text = [IO.File]::ReadAllText($artifactPath)
    $count = ([regex]::Matches($text, [regex]::Escape($upstreamPackage))).Count
    if ($count -lt 1) { throw "Agent Presets package identity anchor changed: $artifact" }
    $text = $text.Replace($upstreamPackage, $productPackage)
    [IO.File]::WriteAllText($artifactPath, $text, [Text.UTF8Encoding]::new($false))
}

$clientPath = Join-Path $target 'client.js'
$client = [IO.File]::ReadAllText($clientPath)
$client = $client -replace '(?m)^//# sourceMappingURL=client\.js\.map\s*$', ''

function Replace-Exactly([string]$Name, [string]$Before, [string]$After) {
    $script:client = $script:client.Replace("`r`n", "`n")
    $Before = $Before.Replace("`r`n", "`n")
    $After = $After.Replace("`r`n", "`n")
    $count = ([regex]::Matches($script:client, [regex]::Escape($Before))).Count
    if ($count -ne 1) { throw "DSH Agent Presets compatibility anchor changed: $Name ($count matches)" }
    $script:client = $script:client.Replace($Before, $After)
}

Replace-Exactly 'optional policy helper' @'
		function AgentPresetSection(props) {
			const { useAgentPresetSection, t, load } = props;
			const state = useAgentPresetSection((snapshot) => snapshot);
'@ @'
		const PRODUCT_OPTIONAL_PRESETS = ["minimal", "cordis"];
		function productPresetRows(rows) {
			return [...rows.filter((row) => !PRODUCT_OPTIONAL_PRESETS.includes(row.id)), ...PRODUCT_OPTIONAL_PRESETS.map((id) => rows.find((row) => row.id === id) ?? ({
				id,
				trust: "system",
				isDefault: false,
				productDisabled: true
			}))];
		}
		function AgentPresetSection(props) {
			const { useAgentPresetSection, t, load } = props;
			const state = useAgentPresetSection((snapshot) => snapshot);
			const [optionalBusy, setOptionalBusy] = (0, react.useState)("");
			const [optionalError, setOptionalError] = (0, react.useState)("");
			const productRows = productPresetRows(state.rows);
'@

Replace-Exactly 'render complete product roster' @'
					const group = state.rows.filter((row) => row.trust === trust).map((row) => ({
'@ @'
					const group = productRows.filter((row) => row.trust === trust).map((row) => ({
'@

Replace-Exactly 'optional error surface' @'
					state.error === null ? null : (0, react_jsx_runtime.jsx)("p", {
						className: AgentPresetSection_module_css_default.error,
						role: "alert",
						children: state.error
					}),
'@ @'
					state.error === null ? null : (0, react_jsx_runtime.jsx)("p", {
						className: AgentPresetSection_module_css_default.error,
						role: "alert",
						children: state.error
					}),
					optionalError === "" ? null : (0, react_jsx_runtime.jsx)("p", {
						className: AgentPresetSection_module_css_default.error,
						role: "alert",
						children: optionalError
					}),
'@

Replace-Exactly 'disabled card action boundary' @'
												"aria-pressed": row.isDefault,
												disabled: row.isDefault,
												"aria-disabled": row.broken !== void 0,
												"aria-label": `${row.broken !== void 0 ? t("brokenBadge") : row.isDefault ? t("inUse") : t("setDefault")}: ${text.name}`,
												title: row.broken !== void 0 ? t("brokenBadge") : row.isDefault ? t("inUse") : t("setDefault"),
												onClick: () => {
													if (row.broken !== void 0) return;
													props.makeDefault(row.id);
												},
'@ @'
												"aria-pressed": row.isDefault,
												disabled: row.productDisabled || row.isDefault,
												"aria-disabled": row.productDisabled || row.broken !== void 0,
												"aria-label": `${row.productDisabled ? "已关闭" : row.broken !== void 0 ? t("brokenBadge") : row.isDefault ? t("inUse") : t("setDefault")}: ${text.name}`,
												title: row.productDisabled ? "启用后可用于新会话" : row.broken !== void 0 ? t("brokenBadge") : row.isDefault ? t("inUse") : t("setDefault"),
												onClick: () => {
													if (row.productDisabled || row.broken !== void 0) return;
													props.makeDefault(row.id);
												},
'@

Replace-Exactly 'disabled badge' @'
children: row.trust === "user" ? t("userTrust") : t("builtIn")
'@ @'
children: row.productDisabled ? "已关闭" : row.trust === "user" ? t("userTrust") : t("builtIn")
'@

Replace-Exactly 'optional switches' @'
row.trust === "system" ? row.broken === void 0 ? (0, react_jsx_runtime.jsx)("button", {
'@ @'
PRODUCT_OPTIONAL_PRESETS.includes(row.id) ? (0, react_jsx_runtime.jsxs)("label", {
											style: { display: "inline-flex", alignItems: "center", gap: 8, marginRight: "auto", fontSize: 12, cursor: optionalBusy === "" ? "pointer" : "wait", position: "relative", userSelect: "none" },
											children: [(0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												role: "switch",
												"aria-label": `${row.productDisabled ? "启用" : "关闭"}${text.name}`,
												checked: !row.productDisabled,
												disabled: optionalBusy !== "",
												style: { position: "absolute", width: 1, height: 1, opacity: 0 },
												onChange: (event) => {
															const enable = event.currentTarget.checked;
															const enabled = PRODUCT_OPTIONAL_PRESETS.filter((id) => productRows.some((candidate) => candidate.id === id && !candidate.productDisabled));
															const next = enable ? [...new Set([...enabled, row.id])] : enabled.filter((id) => id !== row.id);
															setOptionalBusy(row.id);
															setOptionalError("");
															props.setOptionalPresets(next).catch((error) => {
																setOptionalError(error instanceof Error ? error.message : String(error));
															}).finally(() => {
																setOptionalBusy("");
															});
												}
											}), (0, react_jsx_runtime.jsx)("span", {
												"aria-hidden": "true",
												style: { display: "inline-flex", alignItems: "center", width: 34, height: 20, padding: 2, boxSizing: "border-box", borderRadius: 999, background: row.productDisabled ? "var(--dsw-alias-border-l1)" : "var(--dsw-alias-brand-primary)", transition: "background .16s" },
												children: (0, react_jsx_runtime.jsx)("span", { style: { width: 16, height: 16, borderRadius: "50%", background: "var(--dsw-alias-bg-base)", boxShadow: "0 1px 3px rgba(0,0,0,.28)", transform: row.productDisabled ? "translateX(0)" : "translateX(14px)", transition: "transform .16s" } })
											}), (0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-secondary)" }, children: row.productDisabled ? "已关闭" : "已启用" })]
										}) : null,
												row.productDisabled ? null : row.trust === "system" ? row.broken === void 0 ? (0, react_jsx_runtime.jsx)("button", {
'@

Replace-Exactly 'disable duplicate for unavailable preset' @'
													disabled: !state.authorable || row.broken !== void 0,
'@ @'
													disabled: row.productDisabled || !state.authorable || row.broken !== void 0,
'@

Replace-Exactly 'optional preset writer' @'
			const sectionInjected = () => ({
'@ @'
			const setOptionalPresets = async (requested) => {
				const enabled = PRODUCT_OPTIONAL_PRESETS.filter((id) => requested.includes(id));
				const rosterBefore = await ctx.remote.agentPresets.list();
				if (!rosterBefore.ok) throw new Error(rosterBefore.error.message);
				const currentDefault = rosterBefore.value.presets.find((row) => row.isDefault)?.id;
				if (PRODUCT_OPTIONAL_PRESETS.includes(currentDefault) && !enabled.includes(currentDefault)) {
					const fallback = await ctx.remote.settings.update("agent-presets", { default: "standard" }, void 0);
					if (!fallback.ok) throw new Error(fallback.error.message);
				}
				const response = await ctx.remote.settings.update("chatecnu-brand", { enabledOptionalPresets: enabled }, void 0);
				if (!response.ok) throw new Error(response.error.message);
				let converged = false;
				for (let attempt = 0; attempt < 150; attempt += 1) {
					const read = await ctx.remote.agentPresets.list();
					if (read.ok) {
						const ids = new Set(read.value.presets.map((row) => row.id));
						converged = PRODUCT_OPTIONAL_PRESETS.every((id) => ids.has(id) === enabled.includes(id));
						if (converged) break;
					}
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				if (!converged) throw new Error("Agent 预设同步尚未完成，请重试；设置已保存，不会丢失");
				await section.load();
				await controller.load();
				for (const read of rosterReaders) read();
			};
			const sectionInjected = () => ({
'@

Replace-Exactly 'inject optional preset writer' @'
				remove: () => section.remove(),
				makeDefault: (id) => section.makeDefault(id)
'@ @'
				remove: () => section.remove(),
				makeDefault: (id) => section.makeDefault(id),
				setOptionalPresets
'@

[IO.File]::WriteAllText($clientPath, $client, [Text.UTF8Encoding]::new($false))
& (Join-Path $PSScriptRoot '..\..\scripts\normalize-generated-client.ps1') -Path $target
Write-Host 'Built ChatECNU Work Agent Presets derivative with optional-preset switches.'
