import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Script } from 'node:vm'

// EduWork keeps Creator optional. rc.3's new More menus bypass the roster gate
// used by the upstream Add plugin menu. Retire when upstream gates these too.
// Only the Creator item is adapted; navigation, prompts and draft policy stay native.
export const entryCustomizationPatch = Object.freeze({
  id: 'entry-customization-optional-creator-v1',
  package: '@deepseek-ai/dsh-client-ui-entry-customization', version: '0.2.1-rc.3',
  file: 'lib/client.js', beforeSHA256: '287f36fe74f6be3eb5ab51ec0c1f09ae8cacea8a01fe56b3966553106c69f7e4',
})
const sha256 = value => createHash('sha256').update(value).digest('hex')

// Query the official roster, never turn a preset on or mutate a user's draft.
export async function creatorAvailability(ctx) {
  if (!ctx.configForms.developerTools.enabled.getSnapshot()) return 'toolsDisabled'
  const result = await ctx.remote.agentPresets.list()
  if (!result.ok) throw new Error(result.error.message)
  // Recheck after the RPC: the user can disable tools while it is in flight.
  if (!ctx.configForms.developerTools.enabled.getSnapshot()) return 'toolsDisabled'
  return result.value.presets.some(row => row.id === 'cordis' && !row.broken) ? 'ready' : 'disabled'
}

export function creatorEntryComponent(React, MenuItemButton, PlusIcon) {
  return function CreatorEntry({ checkCreator, createPlugin, onDismiss, t }) {
    const [status, setStatus] = React.useState('checking')
    const live = React.useRef(false)
    const pending = React.useRef(false)
    React.useEffect(() => {
      live.current = true
      checkCreator().then(value => { if (live.current) setStatus(value) }, () => { if (live.current) setStatus('unavailable') })
      return () => { live.current = false }
    }, [checkCreator])
    return React.createElement(MenuItemButton, {
      icon: React.createElement(PlusIcon, { size: 16 }), disabled: status !== 'ready',
      onSelect: async () => {
        if (pending.current || status !== 'ready') return
        pending.current = true
        setStatus('checking')
        try {
          const current = await checkCreator()
          if (!live.current) return
          if (current !== 'ready') { setStatus(current); return }
          onDismiss()
          createPlugin()
        } catch { if (live.current) setStatus('unavailable') }
        finally { pending.current = false }
      },
    }, React.createElement('span', null, t('create'), status === 'ready' ? null :
      React.createElement('small', { style: { display: 'block' } }, t('creator.' + status))))
  }
}

export function patchEntryCustomizationSource(input) {
  if (sha256(input) !== entryCustomizationPatch.beforeSHA256) throw new Error('Entry customization input changed; review or retire the Creator gate')
  let source = input.toString('utf8')
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Entry customization anchor changed: ' + before)
    source = source.replace(before, after)
  }
  replace('function EntryMenuContent({ entries, onOpen, region, onDismiss, browsePlugins, createPlugin, t }) {',
    `${creatorEntryComponent.toString()}\n${creatorAvailability.toString()}\nconst EduWorkCreatorEntry = creatorEntryComponent(require("react"), _deepseek_ai_dsh_client_ui_primitives.MenuItemButton, _deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular);\nfunction EntryMenuContent({ entries, onOpen, region, onDismiss, browsePlugins, createPlugin, checkCreator, t }) {`)
  const start = source.indexOf('(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular')
  const end = source.indexOf('\n\t\t\t] });', start)
  if (start < 0 || end < 0) throw new Error('Creator item boundary changed')
  source = source.slice(0, start) + '(0, react_jsx_runtime.jsx)(EduWorkCreatorEntry, { checkCreator, createPlugin, onDismiss, t })' + source.slice(end)
  replace('const en = {', 'const en = { "creator.checking": "Checking Creator…", "creator.unavailable": "Could not check Creator. Reopen this menu to retry.", "creator.disabled": "Enable Creator in Settings → Agent presets", "creator.toolsDisabled": "Enable Show coding view in Settings → General",')
  replace('const zh = {', 'const zh = { "creator.checking": "正在检查 Creator…", "creator.unavailable": "无法检查 Creator，请重新打开菜单重试", "creator.disabled": "请在设置 → Agent 预设中开启 Creator", "creator.toolsDisabled": "请在设置 → 通用设置中开启“显示代码工作视图”",')
  replace('"uiWorkspace"\n', '"uiWorkspace", "remote", "remote.agentPresets", "configForms"\n')
  replace('const injected = (region) => ({', 'const checkCreator = () => creatorAvailability(ctx);\nconst injected = (region) => ({ checkCreator,')
  new Script(source, { filename: 'entry-customization.js' })
  return source
}

export async function patchEntryCustomizationRuntime(modules) {
  const root = join(modules, entryCustomizationPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== entryCustomizationPatch.package || manifest.version !== entryCustomizationPatch.version) throw new Error('Entry customization requires a newly qualified Runtime')
  const path = join(root, entryCustomizationPatch.file), output = patchEntryCustomizationSource(await readFile(path))
  await writeFile(path, output)
  return { ...entryCustomizationPatch, afterSHA256: sha256(output) }
}
