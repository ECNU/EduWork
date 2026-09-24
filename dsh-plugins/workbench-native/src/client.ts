import { downloadDiagnosticArchive } from '../lib/diagnostic-download.js'
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import remote from '../lib/typert.remote-client.js'
import {createUpdateController,UpdatePanel,UpdateFooter} from './updates'
import {DataImportPanel} from './data-import'
import {ConcurrencySettings} from './concurrency'
import {NotificationSettings, installNotificationNavigation} from './notifications'
import {pickImportDirectory} from '../lib/directory-picker.js'
import skillManagerRemote from '@chatecnu-work/dsh-skill-manager-native/remote'
import { canonicalSkillName, effectiveDisabledSkills, skillToggleSettings, skillGroups, skillCenterRows } from '../lib/view-model.js'
declare const __EDUWORK_NATIVE_017__: boolean
const nativeSettings = typeof __EDUWORK_NATIVE_017__ !== 'undefined' && __EDUWORK_NATIVE_017__
export const inject = ['slots','remote','remote.skills','connection','sessions',nativeSettings ? 'configForms' : 'settingsScope','uiWorkspace']
const h = React.createElement
const color = 'var(--dsw-alias-state-business-primary, #9f2636)'
const border = 'var(--dsw-alias-border-l2, #e1e4eb)'
const panelStyle = Object.freeze({
  position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center',
  background: 'rgba(32, 24, 21, 0.30)', backdropFilter: 'blur(4px)',
})
const cardStyle = Object.freeze({
  width: 'min(460px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 48px)', overflow: 'auto',
  border: `1px solid ${border}`, borderRadius: 16, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #222)',
  boxShadow: '0 22px 70px rgba(61, 35, 31, .18)', padding: 22, fontFamily: 'system-ui, sans-serif',
})
const buttonStyle = Object.freeze({
  border: `1px solid ${border}`, borderRadius: 9, padding: '8px 12px', background: '#fffaf7',
  color: '#352622', cursor: 'pointer', fontSize: 13,
})
const primaryStyle = Object.freeze({ ...buttonStyle, background: color, borderColor: color, color: 'white', fontWeight: 650 })

function SkillCenter({ service, embedded = false }) {
  const settings = useSyncExternalStore(
    listener => service.settings.subscribe(listener),
    () => service.settings.getSnapshot(),
    () => service.settings.getSnapshot(),
  )
  const [catalog, setCatalog] = useState([])
  const credentialReady = false
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState(null as any)
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '' })

  const refresh = async () => {
    setCatalog(await service.list())
  }
  useEffect(() => {
    const report = cause => setError(cause instanceof Error ? cause.message : String(cause))
    const off = service.subscribeSession(() => { refresh().then(() => setError('')).catch(report) })
    refresh().then(() => setError('')).catch(report)
    return off
  }, [])

  const skillSettings = settings.value ?? {}
  const disabled = Array.isArray(skillSettings.disabled) ? skillSettings.disabled : []
  const enabled = Array.isArray(skillSettings.enabled) ? skillSettings.enabled : []
  const defaultDisabled = Array.isArray(skillSettings.defaultDisabled) ? skillSettings.defaultDisabled : []
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const rows = useMemo(
    () => skillCenterRows(catalog, skillSettings, credentialReady)
      .filter(row => !normalizedQuery || `${row.label} ${row.name} ${row.description}`.toLocaleLowerCase().includes(normalizedQuery)),
    [catalog, credentialReady, disabled.join('\u0000'), enabled.join('\u0000'), defaultDisabled.join('\u0000'), normalizedQuery],
  )

  const toggle = async (row) => {
    const { disabled: nextDisabled, enabled: nextEnabled } = skillToggleSettings(skillSettings, row.name, !row.enabled)
    setBusy(row.name)
    setError('')
    try {
      await service.settings.set('disabled', nextDisabled)
      await service.settings.set('enabled', nextEnabled)
      const persisted = service.settings.getSnapshot()
      if (persisted.status !== 'ready') {
        throw new Error('技能设置未能保存，请检查当前连接后重试。')
      }
      const isDisabled = effectiveDisabledSkills(persisted.value).has(canonicalSkillName(row.name))
      if (isDisabled !== row.enabled) {
        throw new Error('技能设置没有生效，请重试。')
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy('') }
  }

  const importSkill = async () => {
    setBusy('import')
    setError('')
    setNotice('')
    try {
      const path = await service.pickDirectory()
      if (path === null) return
      const imported = await service.importDirectory(path)
      setNotice(`已导入技能“${imported.name}”。`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy('') }
  }

  const createSkill = async (event) => {
    event.preventDefault()
    setBusy('create')
    setError('')
    setNotice('')
    try {
      const created = await service.create(draft)
      setDraft({ name: '', description: '', instructions: '' })
      setCreateOpen(false)
      setNotice(`已创建技能“${created.name}”。`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy('') }
  }

  const removeSkill = async () => {
    if (!pendingRemoval) return
    const name = pendingRemoval.name
    setBusy(`remove:${name}`)
    setError('')
    setNotice('')
    try {
      await service.remove(name)
      await service.settings.set('disabled', disabled.filter(value => value !== name))
      await service.settings.set('enabled', enabled.filter(value => value !== name))
      setPendingRemoval(null)
      setNotice(`已移除个人技能“${name}”。新会话将不再发现它。`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy('') }
  }

  const header = h('div', { style: { marginBottom: 18, display: 'flex', justifyContent: embedded ? 'flex-end' : 'space-between', alignItems: 'flex-start', gap: 16 } },
    !embedded && h('div', null,
      h('h3', { style: { margin: '0 0 5px', fontSize: 20 } }, '技能'),
      h('p', { style: { margin: 0, color: '#75635c', fontSize: 13, lineHeight: 1.6 } },
        '按用途选择技能。在对话和 Studio 中创作，共用同一套制作与文件预览能力。'),
    ),
    h('div', { style: { display: 'flex', gap: 8, flex: 'none' } },
      h('button', { type: 'button', disabled: busy !== '', style: buttonStyle, onClick: importSkill }, busy === 'import' ? '正在导入…' : '导入'),
      h('button', { type: 'button', disabled: busy !== '', style: primaryStyle, onClick: () => { setError(''); setNotice(''); setCreateOpen(true) } }, '创建技能'),
    ),
  )
  if (settings.status === 'loading') return h('div', null, header, h('p', null, '正在读取技能设置…'))
  if (settings.status !== 'ready') return h('div', null, header, h('p', { role: 'alert' }, '当前连接无法维护技能设置。'))
  return h('div', { style: { width: '100%', maxWidth: 820 } }, header,
    h('input', {
      type: 'search', value: query, placeholder: '搜索技能', 'aria-label': '搜索技能',
      onChange: event => setQuery(event.currentTarget.value),
      style: { boxSizing: 'border-box', width: '100%', height: 38, border: `1px solid ${border}`, borderRadius: 9, padding: '0 12px', marginBottom: 14, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #222)' },
    }),
    error && h('p', { role: 'alert', style: { color: '#a82332', fontSize: 12 } }, error),
    notice && h('p', { role: 'status', style: { color: '#357a55', fontSize: 12 } }, notice),
    !service.hasSession() && h('p', { style: { color: '#8a766f', fontSize: 12 } }, '打开一个项目后，还会显示该项目专属的技能。'),
    rows.length === 0 && h('p', { role: 'status' }, '没有匹配的技能。'),
    ...skillGroups.filter(group => rows.some(row => row.group === group.id)).map(group => h('section', {
      key: group.id, 'aria-label': group.label, style: { marginBottom: 22 },
    },
    h('h4', { style: { margin: '0 0 10px', fontSize: 14, color: '#66534d' } }, group.label),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 } },
      ...rows.filter(row => row.group === group.id).map(row => h('article', {
        key: row.name,
        'data-skill-name': row.name,
        style: { border: `1px solid ${border}`, borderRadius: 12, padding: 14, background: 'var(--dsw-alias-bg-layer-1, #fff)', opacity: row.available ? 1 : .72 },
      },
      h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } },
        h('div', { style: { minWidth: 0 } },
          h('strong', { style: { display: 'block', fontSize: 14 } }, row.label),
          h('code', { style: { display: 'block', marginTop: 2, color: '#8a766f', fontSize: 11 } }, row.name),
        ),
        h('button', {
          type: 'button', role: 'switch', 'aria-label': row.label, 'aria-checked': row.enabled, disabled: busy !== '' || !settings.writable,
          onClick: () => toggle(row),
          style: { ...buttonStyle, flex: 'none', minWidth: 52, padding: '5px 9px', background: row.enabled ? color : '#f2ece8', color: row.enabled ? 'white' : '#75635c', borderColor: row.enabled ? color : border },
        }, busy === row.name ? '…' : row.enabled ? '已开启' : '已关闭'),
      ),
      h('p', { style: { minHeight: 38, margin: '10px 0 8px', color: '#66534d', fontSize: 12, lineHeight: 1.55 } }, row.description),
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: '#8a766f', fontSize: 11 } },
        h('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap' } },
          h('span', null, row.source === 'builtin' ? '产品内置' : row.source === 'personal' ? '个人技能' : row.source === 'session' ? '会话可用' : '项目技能'),
          !row.available && h('span', { style: { color: '#a26b22' } }, row.requirement || '需要配置相应服务'),
        ),
        row.removable && h('button', {
          type: 'button', disabled: busy !== '',
          onClick: () => { setError(''); setNotice(''); setPendingRemoval(row) },
          style: { ...buttonStyle, flex: 'none', padding: '4px 8px', borderColor: '#edc9cd', background: '#fff7f7', color: '#a82332', fontSize: 11 },
        }, '移除'),
      ),
      row.variants.length > 0 && h('details', { style: { marginTop: 10, fontSize: 12, color: '#66534d' } },
        h('summary', { style: { cursor: 'pointer' } }, '已安装的自定义版本'),
        ...row.variants.map(variant => h('div', { key: `${variant.source}:${variant.name}`, style: { marginTop: 10 } },
          h('strong', null, variant.name),
          h('p', { style: { margin: '4px 0', lineHeight: 1.55 } }, variant.legacy
            ? '旧名称已归并到此技能，当前内置版本优先。原文件保留供你管理。'
            : String(variant.description || '此技能的自定义说明。')),
          variant.source === 'personal' && variant.removable === true && h('button', {
            type: 'button', disabled: busy !== '', style: { ...buttonStyle, padding: '4px 8px' },
            onClick: () => { setError(''); setNotice(''); setPendingRemoval(variant) },
          }, '移除个人版本'),
        )),
      ))),
    ))),
    createOpen && h('div', { style: panelStyle, role: 'presentation', onMouseDown: event => { if (event.target === event.currentTarget && busy !== 'create') setCreateOpen(false) } },
      h('form', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '创建个人技能', style: cardStyle, onSubmit: createSkill },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12 } },
          h('div', null,
            h('div', { style: { color, fontSize: 11, fontWeight: 750, letterSpacing: '.08em' } }, 'PERSONAL SKILL'),
            h('h2', { style: { margin: '5px 0 4px', fontSize: 22 } }, '创建个人技能'),
            h('p', { style: { margin: 0, color: '#75635c', fontSize: 12, lineHeight: 1.55 } }, '创建后立即进入 DSH 标准技能目录，可随时关闭。'),
          ),
          h('button', { type: 'button', disabled: busy === 'create', 'aria-label': '关闭', onClick: () => setCreateOpen(false), style: { ...buttonStyle, padding: '5px 9px' } }, '×'),
        ),
        h('label', { style: { display: 'block', marginTop: 17, fontSize: 12, fontWeight: 650 } }, '技能标识',
          h('input', {
            value: draft.name, required: true, maxLength: 64, pattern: '[a-z0-9]+(?:-[a-z0-9]+)*', placeholder: '例如 meeting-helper',
            onChange: event => setDraft({ ...draft, name: event.currentTarget.value }),
            style: { boxSizing: 'border-box', display: 'block', width: '100%', marginTop: 6, height: 38, border: `1px solid ${border}`, borderRadius: 9, padding: '0 10px', background: 'white' },
          }),
        ),
        h('label', { style: { display: 'block', marginTop: 13, fontSize: 12, fontWeight: 650 } }, '用途说明',
          h('input', {
            value: draft.description, required: true, maxLength: 1024, placeholder: '说明它能做什么，以及什么时候应该使用',
            onChange: event => setDraft({ ...draft, description: event.currentTarget.value }),
            style: { boxSizing: 'border-box', display: 'block', width: '100%', marginTop: 6, height: 38, border: `1px solid ${border}`, borderRadius: 9, padding: '0 10px', background: 'white' },
          }),
        ),
        h('label', { style: { display: 'block', marginTop: 13, fontSize: 12, fontWeight: 650 } }, '工作指令',
          h('textarea', {
            value: draft.instructions, required: true, rows: 8, placeholder: '写清楚 Agent 应遵循的步骤、边界和交付要求。',
            onChange: event => setDraft({ ...draft, instructions: event.currentTarget.value }),
            style: { boxSizing: 'border-box', display: 'block', resize: 'vertical', width: '100%', marginTop: 6, border: `1px solid ${border}`, borderRadius: 9, padding: 10, background: 'white', lineHeight: 1.55 },
          }),
        ),
        error && h('p', { role: 'alert', style: { margin: '13px 0 0', padding: 9, borderRadius: 8, background: '#fff0f0', color: '#a82332', fontSize: 12 } }, error),
        h('div', { style: { marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          h('button', { type: 'button', disabled: busy === 'create', style: buttonStyle, onClick: () => setCreateOpen(false) }, '取消'),
          h('button', { type: 'submit', disabled: busy === 'create', style: primaryStyle }, busy === 'create' ? '正在创建…' : '创建'),
        ),
      ),
    ),
    pendingRemoval && h('div', {
      style: panelStyle, role: 'presentation',
      onMouseDown: event => { if (event.target === event.currentTarget && busy === '') setPendingRemoval(null) },
    },
    h('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '移除个人技能', style: cardStyle },
      h('div', { style: { color: '#a82332', fontSize: 11, fontWeight: 750, letterSpacing: '.08em' } }, 'REMOVE PERSONAL SKILL'),
      h('h2', { style: { margin: '6px 0 8px', fontSize: 21 } }, `移除“${pendingRemoval.label}”？`),
      h('p', { style: { margin: 0, color: '#66534d', fontSize: 13, lineHeight: 1.65 } },
        '该技能会移出 Agent 的个人技能目录，并保留在本地回收区。历史会话不受影响；已经注入当前会话的内容可能持续到新建会话。'),
      error && h('p', { role: 'alert', style: { margin: '13px 0 0', padding: 9, borderRadius: 8, background: '#fff0f0', color: '#a82332', fontSize: 12 } }, error),
      h('div', { style: { marginTop: 19, display: 'flex', justifyContent: 'flex-end', gap: 8 } },
        h('button', { type: 'button', disabled: busy !== '', style: buttonStyle, onClick: () => setPendingRemoval(null) }, '取消'),
        h('button', {
          type: 'button', disabled: busy !== '', onClick: removeSkill,
          style: { ...primaryStyle, background: '#a82332', borderColor: '#a82332' },
        }, busy === `remove:${pendingRemoval.name}` ? '正在移除…' : '移除'),
      ),
    )),
  )
}

const unwrap = async operation => { const result = await operation; if (result?.ok) return result.value; throw new Error(result?.error?.message || '工作台服务暂时不可用') }
function DesktopSettings({service,controller}) {
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const diagnostics=async()=>{
  if(busy)return
  setBusy(true);setError('');setMessage('')
  try{
   const result=await service('diagnostics')
   downloadDiagnosticArchive(result)
   setMessage('诊断包已生成，请查看下载目录。对话问题请同时导出该会话的 Session log。')
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const section={padding:'16px 0',borderBottom:'1px solid '+border}
 const note={margin:'4px 0 0',color:'var(--dsw-alias-label-secondary)',fontSize:12,lineHeight:1.55}
 return h(React.Fragment,null,
  h('section',{style:section},h(UpdatePanel,{controller})),
  h('section',{style:section},
   h('div',{style:{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16}},
    h('div',{style:{minWidth:0}},h('div',{style:{fontSize:14}},'故障诊断'),
     h('p',{style:note},'导出 ZIP 诊断包，包含组件版本、启动与更新信息、脱敏日志；会话正文需另行导出。')),
    h('button',{type:'button',disabled:busy,style:{...buttonStyle,flexShrink:0,whiteSpace:'nowrap',background:'var(--dsw-alias-bg-layer-1, #fff)',color:'inherit'},onClick:diagnostics},busy?'正在整理…':'导出诊断')),
   message&&h('p',{role:'status',style:{...note,marginTop:10}},message),
   error&&h('p',{role:'alert',style:{...note,marginTop:10,color:'var(--dsw-alias-state-error-primary, #a82332)',overflowWrap:'anywhere'}},error)))
}
// The official Plugins page owns the title, summary, list and back navigation.
// Keep the same skill service and editor for both desktop generations.
function SkillPluginPage({ service, view }) {
  return view === 'summary'
    ? h(React.Fragment, null, '管理内置、个人与项目技能，供对话和 Studio 共用。')
    : h(SkillCenter, { service, embedded: true })
}

export async function apply(ctx) {
  const unmount = await ctx.remote.$mount(remote), unmountSkills = await ctx.remote.$mount(skillManagerRemote)
  ctx.inject(['remote.workbench','remote.skillManager'], inner=>{
    const notifications = installNotificationNavigation(inner, view => unwrap(inner.remote.workbench.notificationView(view)))
    inner.on('dispose', () => notifications.close())
    const notificationScope = nativeSettings ? inner.configForms.get('eduwork-notifications') : inner.settingsScope.bind({ namespace: 'eduwork-notifications' })
    inner.slots.inject('settings.general.item', () => inner.slots.register({ name: 'settings.general.item', id: 'eduwork-notifications', order: 19,
      inject: () => ({ scope: notificationScope, status: notifications.status }) }, NotificationSettings))
    const service={settings:(nativeSettings ? inner.configForms.get('chatecnu-skills') : inner.settingsScope.bind({ namespace: 'chatecnu-skills' })),hasSession:()=>Boolean(inner.sessions.list.getSnapshot().current),subscribeSession:fn=>inner.sessions.list.subscribe(fn),
      list:async()=>{const result=await unwrap(inner.remote.workbench.catalog());const id=inner.sessions.list.getSnapshot().current;if(!id||!inner.remote.skills)return result.skills;const session=await unwrap(inner.remote.skills.list({sessionId:id}));const known=new Set(result.skills.map(row=>canonicalSkillName(row.name)));return [...result.skills,...session.skills.filter(row=>!known.has(canonicalSkillName(row.name))).map(row=>({...row,source:'session',available:true,removable:false}))]},
      create:input=>unwrap(inner.remote.skillManager.create(input)),importDirectory:path=>unwrap(inner.remote.skillManager.importDirectory(path)),remove:name=>unwrap(inner.remote.skillManager.trashPersonalSkill(name)),pickDirectory:()=>pickImportDirectory(inner.uiWorkspace)}
    if (nativeSettings) {
      inner.slots.inject('plugins.item', () => inner.slots.register({
        name: 'plugins.item', id: 'eduwork-skills', order: -20, label: '技能', inject: () => ({ service }),
      }, SkillPluginPage))
    } else {
      inner.slots.inject('settings.plugins.tab',()=>inner.slots.register({name:'settings.plugins.tab',id:'skills',order:-20,label:'技能',inject:()=>({service})},SkillCenter))
    }
    const desktop=action=>unwrap(inner.remote.workbench.desktop(action)), updates=createUpdateController(desktop)
    const dataImport={pickDirectory:()=>pickImportDirectory(inner.uiWorkspace),preview:path=>unwrap(inner.remote.workbench.inspectImport(path)),start:id=>unwrap(inner.remote.workbench.importData(id)),cancel:()=>unwrap(inner.remote.workbench.cancelImport()),status:()=>unwrap(inner.remote.workbench.importStatus())}
    inner.on('dispose',()=>updates.dispose())
    inner.slots.inject('sidebar.footer.action',()=>inner.slots.register({name:'sidebar.footer.action',id:'eduwork-updates',order:90,inject:()=>({controller:updates})},UpdateFooter))
    inner.slots.inject('settings.general.item',()=>inner.slots.register({name:'settings.general.item',id:'eduwork-workbench',order:16,inject:()=>({service:desktop,controller:updates})},DesktopSettings))
    inner.slots.inject('settings.general.item',()=>inner.slots.register({name:'settings.general.item',id:'eduwork-data-import',order:17,inject:()=>({service:dataImport})},DataImportPanel))
    const concurrency=(nativeSettings ? inner.configForms.get('eduwork-concurrency') : inner.settingsScope.bind({ namespace: 'eduwork-concurrency' }))
    inner.slots.inject('settings.general.item',()=>inner.slots.register({name:'settings.general.item',id:'eduwork-concurrency',order:18,inject:()=>({scope:concurrency})},ConcurrencySettings))
  })
  return async()=>{await unmountSkills();await unmount()}
}
