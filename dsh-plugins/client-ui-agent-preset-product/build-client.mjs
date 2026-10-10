// Builds the product Agent Presets derivative with optional-preset switches by
// applying exact anchored edits to the locked upstream bundle. Node.js port of
// build-client.ps1.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyFileTo, ensureDir, fullPath, isFile, isMainModule, readJSON, removeTree } from '../../scripts/lib/build-util.mjs'
import { parseBuilderArgs } from '../../scripts/lib/client-build.mjs'
import { normalizeGeneratedClient } from '../../scripts/normalize-generated-client.mjs'

const upstreamPackage = '@deepseek-ai/dsh-client-ui-agent-preset'
const productPackage = '@chatecnu-work/dsh-client-ui-agent-preset-product'

const anchors = [
  {
    name: 'optional policy helper',
    before: `		function AgentPresetSection(props) {
			const { useAgentPresetSection, t, load } = props;
			const state = useAgentPresetSection((snapshot) => snapshot);`,
    after: `		const PRODUCT_OPTIONAL_PRESETS = ["minimal", "cordis"];
		function productPresetRows(rows) {
			const present = new Set(rows.map((row) => row.id));
			return [...rows, ...PRODUCT_OPTIONAL_PRESETS.filter((id) => !present.has(id)).map((id) => ({
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
			const productRows = productPresetRows(state.rows);`,
  },
  {
    name: 'render complete product roster',
    before: `					const group = state.rows.filter((row) => row.trust === trust).map((row) => ({`,
    after: `					const group = productRows.filter((row) => row.trust === trust).map((row) => ({`,
  },
  {
    name: 'optional error surface',
    before: `					state.error === null ? null : (0, react_jsx_runtime.jsx)("p", {
						className: AgentPresetSection_module_css_default.error,
						role: "alert",
						children: state.error
					}),`,
    after: `					state.error === null ? null : (0, react_jsx_runtime.jsx)("p", {
						className: AgentPresetSection_module_css_default.error,
						role: "alert",
						children: state.error
					}),
					optionalError === "" ? null : (0, react_jsx_runtime.jsx)("p", {
						className: AgentPresetSection_module_css_default.error,
						role: "alert",
						children: optionalError
					}),`,
  },
  {
    name: 'disabled card action boundary',
    before: `												"aria-pressed": row.isDefault,
												disabled: row.isDefault,
												"aria-disabled": row.broken !== void 0,
												"aria-label": \`\${row.broken !== void 0 ? t("brokenBadge") : row.isDefault ? t("inUse") : t("setDefault")}: \${text.name}\`,
												title: row.broken !== void 0 ? t("brokenBadge") : row.isDefault ? t("inUse") : t("setDefault"),
												onClick: () => {
													if (row.broken !== void 0) return;
													props.makeDefault(row.id);
												},`,
    after: `												"aria-pressed": row.isDefault,
												disabled: row.productDisabled || row.isDefault,
												"aria-disabled": row.productDisabled || row.broken !== void 0,
												"aria-label": \`\${row.productDisabled ? "已关闭" : row.broken !== void 0 ? t("brokenBadge") : row.isDefault ? t("inUse") : t("setDefault")}: \${text.name}\`,
												title: row.productDisabled ? "启用后可用于新会话" : row.broken !== void 0 ? t("brokenBadge") : row.isDefault ? t("inUse") : t("setDefault"),
												onClick: () => {
													if (row.productDisabled || row.broken !== void 0) return;
													props.makeDefault(row.id);
												},`,
  },
  {
    name: 'disabled badge',
    before: `children: row.trust === "user" ? t("userTrust") : t("builtIn")`,
    after: `children: row.productDisabled ? "已关闭" : row.trust === "user" ? t("userTrust") : t("builtIn")`,
  },
  {
    name: 'optional switches',
    before: `row.trust === "system" ? row.broken === void 0 ? (0, react_jsx_runtime.jsx)("button", {`,
    after: `PRODUCT_OPTIONAL_PRESETS.includes(row.id) ? (0, react_jsx_runtime.jsxs)("label", {
											style: { display: "inline-flex", alignItems: "center", gap: 8, marginRight: "auto", fontSize: 12, cursor: optionalBusy === "" ? "pointer" : "wait", position: "relative", userSelect: "none" },
											children: [(0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												role: "switch",
												"aria-label": \`\${row.productDisabled ? "启用" : "关闭"}\${text.name}\`,
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
												row.productDisabled ? null : row.trust === "system" ? row.broken === void 0 ? (0, react_jsx_runtime.jsx)("button", {`,
  },
  {
    name: 'disable duplicate for unavailable preset',
    before: `													disabled: !state.authorable || row.broken !== void 0,`,
    after: `													disabled: row.productDisabled || !state.authorable || row.broken !== void 0,`,
  },
  {
    name: 'optional preset writer',
    before: `			const sectionInjected = () => ({`,
    after: `			const setOptionalPresets = async (requested) => {
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
			const sectionInjected = () => ({`,
  },
  {
    name: 'inject optional preset writer',
    before: `				remove: () => section.remove(),
				makeDefault: (id) => section.makeDefault(id)`,
    after: `				remove: () => section.remove(),
				makeDefault: (id) => section.makeDefault(id),
				setOptionalPresets`,
  },
]

export async function buildClient({ upstream = '', runtimePackages = '', dshLockPath = '', output = '' } = {}) {
  const scriptRoot = fullPath(dirname(fileURLToPath(import.meta.url)))
  const repository = fullPath(join(scriptRoot, '..', '..'))
  upstream = fullPath(upstream || join(repository, '.research/upstream/deepseek-harness'))
  if (!dshLockPath) dshLockPath = join(repository, 'third_party/dsh/LOCK.json')
  const lock = await readJSON(dshLockPath)
  let source
  if (runtimePackages) {
    const runtimePackage = join(fullPath(runtimePackages), upstreamPackage)
    const manifest = await readJSON(join(runtimePackage, 'package.json'))
    if (String(manifest.version) !== String(lock.packageVersion)) {
      throw new Error(`Official DSH Agent Presets package version mismatch: expected ${lock.packageVersion}, got ${manifest.version}`)
    }
    source = join(runtimePackage, 'lib')
  } else {
    const { testDshCompatibility } = await import(pathToFileURL(join(repository, 'dsh-desktop/scripts/test-dsh-compatibility.mjs')).href)
    await testDshCompatibility({ upstream, lockPath: dshLockPath })
    source = join(upstream, 'packages/client/ui-agent-preset/lib')
  }
  const target = output ? fullPath(output) : join(scriptRoot, 'lib')
  if (!target.startsWith(repository + sep)) throw new Error('Agent preset output must stay within the repository')
  if (!await isFile(join(source, 'client.js'))) throw new Error(`Locked DSH Agent Presets build is unavailable: ${source}`)
  await removeTree(target)
  await ensureDir(target)
  for (const artifact of ['index.js', 'client.js']) {
    await copyFileTo(join(source, artifact), join(target, artifact))
  }

  const clientPath = join(target, 'client.js')
  let client = await readFile(clientPath, 'utf8')
  const identityCount = client.split(upstreamPackage).length - 1
  if (identityCount < 1) throw new Error('Agent Presets package identity anchor changed: client.js')
  client = client.replaceAll(upstreamPackage, productPackage)
  client = client.replace(/^\/\/# sourceMappingURL=client\.js\.map\s*$/gm, '')

  const replaceExactly = (name, before, after) => {
    client = client.replaceAll('\r\n', '\n')
    before = before.replaceAll('\r\n', '\n')
    after = after.replaceAll('\r\n', '\n')
    const count = client.split(before).length - 1
    if (count !== 1) throw new Error(`DSH Agent Presets compatibility anchor changed: ${name} (${count} matches)`)
    client = client.replace(before, () => after)
  }
  for (const anchor of anchors) replaceExactly(anchor.name, anchor.before, anchor.after)

  await writeFile(clientPath, client)
  await normalizeGeneratedClient(target)
  console.log('Built ChatECNU Work Agent Presets derivative with optional-preset switches.')
}

if (isMainModule(import.meta.url)) {
  const { upstream, runtimePackages, dshLockPath, output } = parseBuilderArgs()
  await buildClient({ upstream, runtimePackages, dshLockPath, output })
}
