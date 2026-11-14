import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Script } from 'node:vm'

// EduWork keeps Creator optional. rc.3's new More menus bypass the roster gate
// used by the upstream Add plugin menu. Retire when upstream gates these too.
// Only the Creator item is adapted; navigation, prompts and draft policy stay native.
export const entryCustomizationPatch = Object.freeze({
  id: 'entry-customization-optional-creator-v1',
  package: '@deepseek-ai/dsh-client-ui-entry-customization', version: '0.2.2-rc.3',
  file: 'lib/client.js', beforeSHA256: 'd7f65b5f629c3e3e2c16a1ee609fbb328a7d2613a6e1f03714e38eda41b53260',
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
  return function CreatorEntry({ checkCreator, createPlugin, onDismiss, separatorBefore, t }) {
    const [status, setStatus] = React.useState('checking')
    const live = React.useRef(false)
    const pending = React.useRef(false)
    React.useEffect(() => {
      live.current = true
      checkCreator().then(value => { if (live.current) setStatus(value) }, () => { if (live.current) setStatus('unavailable') })
      return () => { live.current = false }
    }, [checkCreator])
    return React.createElement(MenuItemButton, {
      icon: React.createElement(PlusIcon, { size: 16 }), separatorBefore, disabled: status !== 'ready',
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
  const signature = 'function EntryMenuContent({entries,onOpen,onPinnedChange,region,onDismiss,usePluginNavigation,browsePlugins,createPlugin,t,renderFactorySlot}){'
  replace(signature,
    `${creatorEntryComponent.toString()}\n${creatorAvailability.toString()}\nconst EduWorkCreatorEntry = creatorEntryComponent(require("react"), _deepseek_ai_dsh_client_ui_primitives.MenuItemButton, _deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular);\n${signature.replace('createPlugin,t,', 'createPlugin,checkCreator,t,')}`)
  // rc.2 ships a compact bundle. Match the complete reviewed menu item, keeping
  // the native pinning handlers and its factory slot untouched.
  replace('(0,react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton,{icon:(0,react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular,{size:16}),separatorBefore:!browsable&&moreEntries.length>0,onSelect:()=>{onDismiss();createPlugin()},children:t(`create`)})',
    '(0,react_jsx_runtime.jsx)(EduWorkCreatorEntry,{checkCreator,createPlugin,onDismiss,separatorBefore:!browsable&&moreEntries.length>0,t})')
  replace('const en={', 'const en={ "creator.checking": "Checking Creator…", "creator.unavailable": "Could not check Creator. Reopen this menu to retry.", "creator.disabled": "Enable Creator in Settings → Agent presets", "creator.toolsDisabled": "Enable Show coding view in Settings → General",')
  replace('const zh={', 'const zh={ "creator.checking": "正在检查 Creator…", "creator.unavailable": "无法检查 Creator，请重新打开菜单重试", "creator.disabled": "请在设置 → Agent 预设中开启 Creator", "creator.toolsDisabled": "请在设置 → 通用设置中开启“显示代码工作视图”",')
  replace('const inject=[`slots`,`locale`,`uiWorkspace`]', 'const inject=[`slots`,`locale`,`uiWorkspace`,`remote`,`remote.agentPresets`,`configForms`]')
  replace('const injected=region=>({', 'const checkCreator=()=>creatorAvailability(ctx);const injected=region=>({checkCreator,')
  new Script(source, { filename: 'entry-customization.js' })
  return source
}

export async function patchEntryCustomizationRuntime(modules) {
  const root = join(modules, entryCustomizationPatch.package)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== entryCustomizationPatch.package || !['0.2.2-rc.2', entryCustomizationPatch.version].includes(manifest.version)) throw new Error('Entry customization requires a newly qualified Runtime')
  const path = join(root, entryCustomizationPatch.file), output = patchEntryCustomizationSource(await readFile(path))
  await writeFile(path, output)
  return { ...entryCustomizationPatch, version: manifest.version, afterSHA256: sha256(output) }
}
