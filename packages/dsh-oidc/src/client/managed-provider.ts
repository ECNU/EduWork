import React, { useEffect, useState } from 'react'
import { modelCapabilitySummary, reasoningEffortOrder, runtimeModelDraft, serializeRuntimeModelDraft } from './presentation.js'

import { useSignIn } from './use-sign-in.js'

const h = React.createElement
const border = 'var(--dsw-alias-border-l2, #e8d9d2)'
const textPrimary = 'var(--dsw-alias-label-primary, #231a17)'
const textSecondary = 'var(--dsw-alias-label-secondary, #75635c)'
const textTertiary = 'var(--dsw-alias-label-tertiary, #8a766f)'
const background = 'var(--dsw-alias-bg-layer-1, #fffdfb)'
const isChinese = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')

const copy: Record<string, string> = isChinese ? {
  waiting: '请在浏览器中完成登录…', cancelLogin: '取消登录',
  title: '学校 / 企业服务', description: '已验证机构和兼容协议服务使用统一入口管理；普通 API Key 提供方继续由 DSH 原生设置管理。',
  loading: '正在读取学校 / 企业服务…', add: '+ 添加学校 / 企业服务', verified: '已验证机构', custom: '自定义服务',
  connected: '已连接', enabled: '已启用', disabled: '未启用', configure: '配置', enable: '启用并重载', login: '登录', provision: '确认创建并连接', refresh: '刷新状态',
  processing: '处理中…', profileManaged: 'Enterprise Profile 管理', addTitle: '添加学校 / 企业服务', addDescription: '选择已验证机构，或填写一个兼容协议 Base URL。',
  addVerified: '添加', compatible: '连接兼容协议服务', compatibleHint: '默认从服务端发现登录、模型和能力。若元数据不完整，添加后可手动补充模型目录。',
  saveService: '保存服务', saving: '保存中…', providerID: 'Provider ID', modelCatalog: '模型目录', defaultContext: '默认上下文', defaultOutput: '默认最大输出',
  unspecified: '未声明', modelCapability: '模型能力', readonlyModels: '该机构的模型参数由 Enterprise Profile 或发行目录管理，只读。',
  customModels: '默认自动发现；仅在服务端元数据不完整时使用手动模式。', automatic: '自动发现', manual: '手动配置',
  baseModel: '基础模型', context: '上下文', output: '最大输出', input: '输入', reasoning: '思考强度', decidedByService: '由服务决定', unsupported: '暂不支持',
  noModels: '尚未同步模型目录。完成机构登录后会自动读取，也可使用手动配置补充。', model: '模型', remove: '删除', modelID: '模型 ID *',
  displayName: '显示名称', baseModelID: '基础模型 ID', contextWindow: '上下文窗口', maxOutput: '最大输出', modalities: '输入模态', reasoningLevels: '思考强度', defaultReasoning: '默认思考强度',
  supportsReasoning: '支持思考', addModel: '+ 添加模型', cancel: '取消', saveModels: '保存模型配置', close: '关闭',
  editAddress: '企业服务地址', editAddressHint: '修改地址会清除与旧服务绑定的本地登录状态；当前已启用时还需要重载 Runtime。', save: '保存修改',
  removeService: '移除服务', deleteService: '删除服务', confirmRemove: '确认从当前配置中移除？以后仍可重新添加。', confirmDelete: '确认永久删除这项本地配置？',
  confirm: '确认删除', disable: '停用并重载', restartNotice: '机构配置已保存。重启后会加载对应的 Provider、品牌和本地能力组合。', restart: '立即重启应用',
  emptyTitle: '尚未配置学校 / 企业服务', emptyHint: '添加只保存配置；需要使用时再显式启用。全局同时只会启用一个企业服务。',
  profileNotice: '应用从受信 Enterprise Profile 读取机构与模型目录；如需修改，请更新 Profile 后重启 DSH。',
  fileHint: '通过配置文件连接学校或企业服务。修改后退出应用，再重新启动。',
  openConfig: '打开配置文件', openExamples: '查看示例',
  configOpened: '已请求系统打开配置文件，修改后请退出并重新启动应用。', examplesOpened: '已请求系统打开示例目录。',
  fileFallback: '请在运行应用的电脑上打开：', examplesHint: '完整示例见同目录下的 examples 文件夹。',
} : {
  waiting: 'Complete sign-in in your browser…', cancelLogin: 'Cancel sign-in',
  title: 'Organization services', description: 'Manage verified organizations and compatible enterprise services here; ordinary API-key providers remain in DSH model settings.',
  loading: 'Loading organization services…', add: '+ Add organization service', verified: 'Verified organization', custom: 'Custom service',
  connected: 'Connected', enabled: 'Enabled', disabled: 'Disabled', configure: 'Configure', enable: 'Enable and reload', login: 'Sign in', provision: 'Confirm and connect', refresh: 'Refresh',
  processing: 'Working…', profileManaged: 'Enterprise Profile managed', addTitle: 'Add organization service', addDescription: 'Select a verified organization or enter a compatible protocol Base URL.',
  addVerified: 'Add', compatible: 'Connect a compatible service', compatibleHint: 'Login, models, and capabilities are discovered by default. A model catalog can be supplied manually when metadata is incomplete.',
  saveService: 'Save service', saving: 'Saving…', providerID: 'Provider ID', modelCatalog: 'Model catalog', defaultContext: 'Default context', defaultOutput: 'Default output',
  unspecified: 'Unspecified', modelCapability: 'Model capabilities', readonlyModels: 'This catalog is read-only and managed by the Enterprise Profile or distribution.',
  customModels: 'Automatic discovery is preferred; use manual mode only when server metadata is incomplete.', automatic: 'Automatic discovery', manual: 'Manual configuration',
  baseModel: 'Base model', context: 'Context', output: 'Max output', input: 'Input', reasoning: 'Reasoning effort', decidedByService: 'Service default', unsupported: 'Unsupported',
  noModels: 'No model catalog is available yet. Sign in to discover models or configure them manually.', model: 'Model', remove: 'Remove', modelID: 'Model ID *',
  displayName: 'Display name', baseModelID: 'Base model ID', contextWindow: 'Context window', maxOutput: 'Max output', modalities: 'Input modalities', reasoningLevels: 'Reasoning effort', defaultReasoning: 'Default reasoning effort',
  supportsReasoning: 'Supports reasoning', addModel: '+ Add model', cancel: 'Cancel', saveModels: 'Save models', close: 'Close',
  editAddress: 'Service address', editAddressHint: 'Changing the address clears the old local login binding and requires a Runtime reload when active.', save: 'Save',
  removeService: 'Remove service', deleteService: 'Delete service', confirmRemove: 'Remove this service from the current configuration?', confirmDelete: 'Permanently delete this local configuration?',
  confirm: 'Confirm', disable: 'Disable and reload', restartNotice: 'Configuration was saved. Reload to apply the Provider, brand, and local capabilities.', restart: 'Restart now',
  emptyTitle: 'No organization service configured', emptyHint: 'Adding a service only saves its configuration. Enable one explicitly when needed; only one service is active at a time.',
  profileNotice: 'The app reads organizations and models from a trusted Enterprise Profile. Update the Profile and restart DSH to change them.',
  fileHint: 'Connect an organization through the configuration file. Quit and relaunch after editing.',
  openConfig: 'Open configuration file', openExamples: 'View examples',
  configOpened: 'The file was sent to your system editor. Quit and relaunch after editing.', examplesOpened: 'The examples folder was sent to your system file manager.',
  fileFallback: 'Open this file on the computer running the app: ', examplesHint: 'Complete examples are in the examples folder beside it.',
}

const buttonStyle = Object.freeze({
  border: `1px solid ${border}`, borderRadius: 9, padding: '8px 12px', background,
  color: textPrimary, cursor: 'pointer', fontSize: 13,
})
const panelStyle = Object.freeze({
  position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 20,
  background: 'rgba(32, 24, 21, .30)', backdropFilter: 'blur(4px)', boxSizing: 'border-box',
})
const cardStyle = Object.freeze({
  width: 'min(760px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 48px)', overflow: 'auto',
  border: `1px solid ${border}`, borderRadius: 16, background, color: textPrimary,
  boxShadow: '0 22px 70px rgba(61, 35, 31, .18)', padding: 22, fontFamily: 'system-ui, sans-serif', boxSizing: 'border-box',
})

const sourceLabel = (value: string) => ({
  preset: isChinese ? '内置审核目录' : 'Reviewed catalog', discovered: isChinese ? '服务端自动发现' : 'Server discovery',
  discovery: isChinese ? '等待服务端同步' : 'Awaiting discovery', manual: isChinese ? '本机手动配置' : 'Local manual catalog',
  profile: copy.profileManaged,
} as Record<string, string>)[value] || (isChinese ? '提供方声明' : 'Provider declaration')
const capabilityLabel = (value: string) => ({ off: isChinese ? '关闭' : 'Off', minimal: isChinese ? '极低' : 'Minimal', low: isChinese ? '低' : 'Low', medium: isChinese ? '中' : 'Medium', high: isChinese ? '高' : 'High', xhigh: isChinese ? '极高' : 'Extra high', max: 'Max' } as Record<string, string>)[value] || value
const modalityLabel = (value: string) => ({ text: isChinese ? '文本' : 'Text', image: isChinese ? '图片' : 'Image', audio: isChinese ? '音频' : 'Audio', video: isChinese ? '视频' : 'Video' } as Record<string, string>)[value] || value
export const managedProviderSectionLabel = isChinese ? '企业服务' : 'Enterprise services'

export function ManagedProviderCard({ service, configuration }: any) {
  const [management, setManagement] = useState<any>(null)
  const [statuses, setStatuses] = useState<Record<string, any>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [baseURL, setBaseURL] = useState('')
  const [detailID, setDetailID] = useState('')
  const [editBaseURL, setEditBaseURL] = useState('')
  const [removeConfirmID, setRemoveConfirmID] = useState('')
  const [editingModels, setEditingModels] = useState(false)
  const [modelDrafts, setModelDrafts] = useState<any[]>([])
  const [restartRequired, setRestartRequired] = useState(false)
  const accent = configuration.profiles[0]?.brand?.primaryColor || 'var(--dsw-alias-state-business-primary, #9f2636)'
  const primaryStyle = { ...buttonStyle, background: accent, borderColor: accent, color: 'white', fontWeight: 650 }
  const inputStyle = { boxSizing: 'border-box', width: '100%', height: 36, border: `1px solid ${border}`, borderRadius: 8, padding: '0 10px', background, color: textPrimary }

  const loadStatuses = async (next: any) => {
    const rows = await Promise.all(next.profiles.filter((profile: any) => profile.enabled).map(async (profile: any) => {
      try { return [profile.id, await service.status(profile.id)] }
      catch { return [profile.id, null] }
    }))
    setStatuses(Object.fromEntries(rows.map(([id]) => [id, service.accountSnapshot(id)])))
  }
  const refreshResources = async (id: string) => {
    if (service.accountSnapshot(id)?.credentialReady) await service.resources(id)
  }
  const refresh = async () => {
    const next = await service.management()
    setManagement(next)
    setRestartRequired(next.restartRequired === true)
    await loadStatuses(next)
    for (const profile of next.profiles.filter((row: any) => row.enabled)) {
      refreshResources(profile.id).then(() => {
        service.management().then(setManagement).catch(() => {})
      }).catch(() => {})
    }
    return next
  }
  useEffect(() => { refresh().catch((cause: any) => setError(cause?.message || String(cause))) }, [])
  useEffect(() => service.subscribeAccounts((id: string) => {
    const status = service.accountSnapshot(id)
    setStatuses(current => ({ ...current, [id]: status }))
    void refreshResources(id).catch(() => {})
  }), [service])

  const run = async (operation: () => Promise<any>, message = '') => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await operation()
      if (result?.profiles) {
        setManagement(result); setRestartRequired(result.restartRequired === true); await loadStatuses(result)
      } else if (result?.profileID) {
        setStatuses(current => ({ ...current, [result.profileID]: service.accountSnapshot(result.profileID) }))
        await refreshResources(result.profileID)
        setManagement(await service.management())
      }
      if (message) setNotice(message)
      return result
    } catch (cause: any) { setError(cause?.message || String(cause)); return null }
    finally { setBusy(false) }
  }
  const login = useSignIn(service)
  const signIn = (profileID: string) => run(() => login.begin(profileID))
  const connect = (profileID: string, status: any) => status?.state === 'authenticated' || status?.state === 'provision_required'
    ? run(() => service.reconcile(profileID, { allowProvision: true }))
    : signIn(profileID)

  if (!management) return h('p', { style: { margin: '18px 0', color: textSecondary, fontSize: 12 } }, copy.loading)
  const canManageProfiles = !configuration.configFile && management.capabilities.manageProfiles === true
  const canManageModels = !configuration.configFile && management.capabilities.manageModels === true
  const noModelsNotice = configuration.configFile
    ? (isChinese ? '尚未同步模型目录。登录后将读取服务端模型；也可在配置文件中声明模型目录。' : 'No model catalog has been synced. Sign in to discover models, or declare them in the configuration file.') : copy.noModels
  const canRestart = management.capabilities.restart === true
  const detail = management.profiles.find((profile: any) => profile.id === detailID) ?? null
  const configured = management.profiles.filter((profile: any) => profile.configured)
  const available = management.profiles.filter((profile: any) => !profile.configured && profile.builtIn)

  const openDetail = (profile: any) => {
    setDetailID(profile.id); setEditBaseURL(profile.baseURL); setRemoveConfirmID(''); setEditingModels(false)
    setModelDrafts((profile.runtime?.models ?? []).map(runtimeModelDraft))
  }
  const enable = (id: string) => run(async () => {
    const result = await service.activate(id)
    if (canRestart) await service.restart()
    return result
  })
  const disable = () => run(async () => {
    const result = await service.activate('')
    if (canRestart) await service.restart()
    return result
  })
  const addCustom = async (event: React.FormEvent) => {
    event.preventDefault()
    const result = await run(() => service.addCustom(baseURL))
    if (result) { setBaseURL(''); setAddOpen(false) }
  }
  const updateCustom = async (event: React.FormEvent) => {
    event.preventDefault()
    const result = await run(() => service.updateCustom(detail.id, editBaseURL))
    if (result?.restartRequired) setRestartRequired(true)
  }
  const removeProfile = async (profile: any) => {
    const result = await run(() => service.removeProfile(profile.id))
    if (!result) return
    setDetailID(''); setRemoveConfirmID('')
    if (profile.enabled && result.restartRequired && canRestart) await service.restart()
  }
  const updateDraft = (index: number, patch: any) => setModelDrafts(current => current.map((draft, candidate) => candidate === index ? { ...draft, ...patch } : draft))
  const toggleDraft = (index: number, field: string, value: string) => setModelDrafts(current => current.map((draft, candidate) => {
    if (candidate !== index) return draft
    const values = Array.isArray(draft[field]) ? draft[field] : []
    return { ...draft, [field]: values.includes(value) ? values.filter((entry: string) => entry !== value) : [...values, value] }
  }))
  const saveModels = async (event: React.FormEvent) => {
    event.preventDefault()
    const result = await run(() => service.configureModels(detail.id, 'manual', modelDrafts.map(serializeRuntimeModelDraft)))
    if (result) setEditingModels(false)
  }
  const useDiscovery = async () => {
    const result = await run(() => service.configureModels(detail.id, 'discovery', []))
    if (result) { setEditingModels(false); setModelDrafts([]) }
  }

  const providerCards = configured.length > 0 ? h('div', { style: { display: 'grid', gap: 10 } }, ...configured.map((profile: any) => {
    const status = statuses[profile.id]
    const connected = profile.enabled && status?.state === 'connected'
    const modelBadges = !profile.providerID
      ? [h('span', { key: 'identity', style: { color: textSecondary, fontSize: 11 } }, isChinese ? '身份登录 · 模型可自行配置' : 'Identity sign-in · configure your own models')]
      : profile.runtime.models.length > 0
      ? profile.runtime.models.map((model: any) => h('code', { key: model.id, style: { borderRadius: 6, padding: '3px 7px', background: 'var(--dsw-alias-bg-layer-2, #f6f1ee)', color: textSecondary, fontSize: 11 } }, model.id))
      : [h('span', { key: 'empty', style: { color: textTertiary, fontSize: 11 } }, noModelsNotice)]
    return h('article', { key: profile.id, style: { border: `1px solid ${profile.enabled ? accent : border}`, borderRadius: 13, background, padding: 15 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 } },
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
            h('strong', { style: { fontSize: 15 } }, profile.displayName),
            h('span', { style: { borderRadius: 999, padding: '2px 7px', background: profile.builtIn ? '#f5e9e8' : '#eef1f6', color: profile.builtIn ? accent : '#536174', fontSize: 11 } }, configuration.configFile ? (isChinese ? '配置文件' : 'Configuration file') : profile.builtIn ? copy.verified : copy.custom),
            h('span', { style: { borderRadius: 999, padding: '2px 7px', border: `1px solid ${connected ? '#b9d9c8' : border}`, color: connected ? '#357a55' : profile.enabled ? accent : textTertiary, fontSize: 11 } }, connected ? copy.connected : profile.enabled ? copy.enabled : copy.disabled)),
          h('div', { style: { marginTop: 6, color: textSecondary, fontSize: 11, overflowWrap: 'anywhere' } }, profile.baseURL),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' } }, ...modelBadges)),
        h('div', { style: { display: 'flex', gap: 7, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' } },
          h('button', { type: 'button', disabled: busy, style: buttonStyle, onClick: () => openDetail(profile) }, canManageProfiles || canManageModels ? copy.configure : (isChinese ? '查看详情' : 'View details')),
          canManageProfiles && !profile.enabled && h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => enable(profile.id) }, copy.enable),
          profile.enabled && !restartRequired && !connected && h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => connect(profile.id, status) }, busy ? copy.processing : (status?.state === 'authenticated' || status?.state === 'provision_required' ? copy.provision : copy.login)),
          profile.enabled && !restartRequired && connected && h('button', { type: 'button', disabled: busy, style: buttonStyle, onClick: () => run(() => service.reconcile(profile.id, { allowProvision: false })) }, copy.refresh))))
  })) : h('div', { style: { padding: 18, border: `1px dashed ${border}`, borderRadius: 13, background } },
    h('strong', { style: { display: 'block', fontSize: 14 } }, copy.emptyTitle),
    h('p', { style: { margin: '6px 0 0', color: textSecondary, fontSize: 12, lineHeight: 1.55 } }, configuration.configFile
      ? (isChinese ? '参考上方示例，在配置文件的 organizations 中填写企业信息，保存并退出后重新启动。也可以直接在模型设置中使用自己的 API Key。' : 'Use the examples above to fill in organizations, save, quit and relaunch. You can also use your own API key in model settings.') : copy.emptyHint))

  const addDialog = addOpen && h('div', { style: panelStyle, onMouseDown: (event: any) => { if (event.target === event.currentTarget && !busy) setAddOpen(false) } },
    h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': copy.addTitle, style: { ...cardStyle, width: 'min(660px, calc(100vw - 40px))' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14 } },
        h('div', null, h('h2', { style: { margin: '0 0 4px', fontSize: 22 } }, copy.addTitle), h('p', { style: { margin: 0, color: textSecondary, fontSize: 12 } }, copy.addDescription)),
        h('button', { type: 'button', disabled: busy, 'aria-label': copy.close, onClick: () => setAddOpen(false), style: buttonStyle }, '×')),
      available.length > 0 && h('div', { style: { display: 'grid', gap: 8, marginTop: 18 } }, ...available.map((profile: any) => h('article', { key: profile.id, style: { display: 'flex', justifyContent: 'space-between', gap: 14, border: `1px solid ${border}`, borderRadius: 11, padding: 13 } },
        h('div', null, h('strong', null, profile.displayName), h('div', { style: { marginTop: 4, color: textTertiary, fontSize: 11 } }, profile.baseURL)),
        h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => run(() => service.configure(profile.id)).then(() => setAddOpen(false)) }, copy.addVerified)))),
      h('form', { onSubmit: addCustom, style: { marginTop: 20, paddingTop: 17, borderTop: `1px solid ${border}` } },
        h('strong', { style: { display: 'block', fontSize: 13 } }, copy.compatible),
        h('p', { style: { margin: '5px 0 10px', color: textSecondary, fontSize: 12 } }, copy.compatibleHint),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { type: 'url', required: true, value: baseURL, placeholder: 'https://ai.example.edu', onChange: (event: any) => setBaseURL(event.currentTarget.value), style: inputStyle }),
          h('button', { type: 'submit', disabled: busy, style: primaryStyle }, busy ? copy.saving : copy.saveService)))))

  const modelEditors = modelDrafts.map((draft, index) => h('article', {
    key: index, style: { border: `1px solid ${border}`, borderRadius: 11, padding: 13 },
  },
  h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 10 } },
    h('strong', null, `${copy.model} ${index + 1}`),
    modelDrafts.length > 1 && h('button', { type: 'button', style: buttonStyle, onClick: () => setModelDrafts(current => current.filter((_, candidate) => candidate !== index)) }, copy.remove)),
  h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 } },
    ...[[copy.modelID, 'id'], [copy.displayName, 'name'], [copy.baseModelID, 'upstreamModelID'], [copy.contextWindow, 'contextWindow'], [copy.maxOutput, 'maxTokens']]
      .map(([label, field]) => h('label', { key: field, style: { fontSize: 11 } }, label,
        h('input', { required: field === 'id', value: draft[field], onChange: (event: any) => updateDraft(index, { [field]: event.currentTarget.value }), style: { ...inputStyle, marginTop: 5 } })))),
  h('div', { style: { marginTop: 10, fontSize: 11 } },
    h('span', { style: { marginRight: 10, color: textSecondary } }, copy.modalities),
    ...['text', 'image', 'audio', 'video'].map(value => h('label', { key: value, style: { marginRight: 11 } },
      h('input', { type: 'checkbox', checked: draft.input.includes(value), onChange: () => toggleDraft(index, 'input', value) }), ` ${modalityLabel(value)}`))),
  h('div', { style: { marginTop: 8, fontSize: 11 } },
    h('span', { style: { marginRight: 10, color: textSecondary } }, copy.reasoningLevels),
    h('label', { style: { marginRight: 12 } }, h('input', { type: 'checkbox', checked: draft.reasoningSupported, onChange: (event: any) => updateDraft(index, { reasoningSupported: event.currentTarget.checked, reasoning: event.currentTarget.checked ? draft.reasoning : [] }) }), ` ${copy.supportsReasoning}`),
    ...(draft.reasoningSupported ? reasoningEffortOrder.map(value => h('label', { key: value, style: { marginRight: 11 } },
      h('input', { type: 'checkbox', checked: draft.reasoning.includes(value), onChange: () => toggleDraft(index, 'reasoning', value) }), ` ${capabilityLabel(value)}`)) : [])),
  draft.reasoningSupported && draft.reasoning.length > 0 && h('label', { style: { display: 'block', marginTop: 9, fontSize: 11 } }, copy.defaultReasoning,
    h('select', { value: draft.reasoning.includes(draft.defaultReasoningEffort) ? draft.defaultReasoningEffort : '', onChange: (event: any) => updateDraft(index, { defaultReasoningEffort: event.currentTarget.value }), style: { ...inputStyle, marginTop: 5 } },
      h('option', { value: '' }, copy.decidedByService),
      ...draft.reasoning.slice().sort((left: string, right: string) => reasoningEffortOrder.indexOf(left) - reasoningEffortOrder.indexOf(right)).map((value: string) => h('option', { key: value, value }, capabilityLabel(value)))))))

  const detailDialog = detail && h('div', { style: panelStyle, onMouseDown: (event: any) => { if (event.target === event.currentTarget && !busy) setDetailID('') } },
    h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${detail.displayName} ${copy.configure}`, style: cardStyle },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14 } },
        h('div', { style: { minWidth: 0 } }, h('h2', { style: { margin: '0 0 4px', fontSize: 22 } }, detail.displayName), h('p', { style: { margin: 0, color: textSecondary, fontSize: 12, overflowWrap: 'anywhere' } }, `${detail.organization} · ${detail.baseURL}`)),
        h('button', { type: 'button', disabled: busy, 'aria-label': copy.close, onClick: () => setDetailID(''), style: buttonStyle }, '×')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8, marginTop: 17 } },
        ...[[copy.providerID, detail.providerID], [copy.modelCatalog, sourceLabel(detail.runtime.modelSource)], [copy.defaultContext, modelCapabilitySummary({}, detail.runtime).contextWindow], [copy.defaultOutput, modelCapabilitySummary({}, detail.runtime).maxTokens]].map(([label, value]) => h('div', { key: label, style: { border: `1px solid ${border}`, borderRadius: 9, padding: 10 } }, h('span', { style: { display: 'block', color: textTertiary, fontSize: 10 } }, label), h('strong', { style: { display: 'block', marginTop: 4, fontSize: 12 } }, value || copy.unspecified)))),
      canManageProfiles && !detail.builtIn && h('form', { onSubmit: updateCustom, style: { marginTop: 16, padding: 12, border: `1px solid ${border}`, borderRadius: 10 } },
        h('strong', { style: { fontSize: 12 } }, copy.editAddress), h('p', { style: { margin: '4px 0 9px', color: textTertiary, fontSize: 11 } }, copy.editAddressHint),
        h('div', { style: { display: 'flex', gap: 8 } }, h('input', { type: 'url', required: true, value: editBaseURL, onChange: (event: any) => setEditBaseURL(event.currentTarget.value), style: inputStyle }), h('button', { type: 'submit', disabled: busy || editBaseURL === detail.baseURL, style: buttonStyle }, copy.save))),
      h('div', { style: { marginTop: 20, display: 'flex', justifyContent: 'space-between', gap: 12 } },
        h('div', null, h('strong', { style: { fontSize: 14 } }, copy.modelCapability), h('p', { style: { margin: '4px 0 0', color: textTertiary, fontSize: 11 } }, canManageModels && !detail.builtIn ? copy.customModels : copy.readonlyModels)),
        canManageModels && !detail.builtIn && h('div', { style: { display: 'flex', gap: 7 } },
          h('button', { type: 'button', disabled: busy, style: buttonStyle, onClick: useDiscovery }, copy.automatic),
          h('button', { type: 'button', disabled: busy, style: editingModels ? primaryStyle : buttonStyle, onClick: () => { setModelDrafts(detail.runtime.models.map(runtimeModelDraft).concat(detail.runtime.models.length ? [] : [runtimeModelDraft()])); setEditingModels(true) } }, copy.manual))),
      !editingModels && h('div', { style: { display: 'grid', gap: 9, marginTop: 11 } }, ...(detail.runtime.models.length > 0 ? detail.runtime.models.map((model: any) => {
        const summary = modelCapabilitySummary(model, detail.runtime)
        return h('article', { key: model.id, style: { border: `1px solid ${border}`, borderRadius: 11, padding: 13 } },
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, h('strong', null, summary.name), summary.name !== summary.id && h('code', { style: { color: textTertiary, fontSize: 11 } }, summary.id), summary.multimodal && h('span', { style: { color: '#355c91', fontSize: 10 } }, isChinese ? '多模态' : 'Multimodal')),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 8, marginTop: 10, color: textSecondary, fontSize: 11 } },
            summary.upstreamModelID && h('span', null, `${copy.baseModel}：${summary.upstreamModelID}`), h('span', null, `${copy.context}：${summary.contextWindow || copy.unspecified}`), h('span', null, `${copy.output}：${summary.maxTokens || copy.unspecified}`),
            h('span', null, `${copy.input}：${summary.input.map(modalityLabel).join('、')}`), h('span', null, `${copy.reasoning}：${!summary.reasoningSupported ? copy.unsupported : summary.reasoningEfforts.length ? summary.reasoningEfforts.map(capabilityLabel).join('、') : copy.decidedByService}`)))
      }) : [h('div', { key: 'empty', style: { border: `1px dashed ${border}`, borderRadius: 11, padding: 14, color: textTertiary, fontSize: 12 } }, noModelsNotice)])),
      editingModels && h('form', { onSubmit: saveModels, style: { marginTop: 11 } },
        h('div', { style: { display: 'grid', gap: 10 } }, ...modelEditors),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 11 } },
          h('button', { type: 'button', style: buttonStyle, onClick: () => setModelDrafts(current => [...current, runtimeModelDraft()]) }, copy.addModel),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('button', { type: 'button', style: buttonStyle, onClick: () => setEditingModels(false) }, copy.cancel),
            h('button', { type: 'submit', disabled: busy, style: primaryStyle }, copy.saveModels)))),
      canManageProfiles && h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${border}` } },
        h('div', null, removeConfirmID === detail.id ? h('span', { style: { color: '#a82332', fontSize: 11 } }, detail.builtIn ? copy.confirmRemove : copy.confirmDelete) : h('button', { type: 'button', disabled: busy, style: { ...buttonStyle, color: '#a82332' }, onClick: () => setRemoveConfirmID(detail.id) }, detail.builtIn ? copy.removeService : copy.deleteService), removeConfirmID === detail.id && h('span', { style: { marginLeft: 8 } }, h('button', { type: 'button', style: buttonStyle, onClick: () => setRemoveConfirmID('') }, copy.cancel), h('button', { type: 'button', style: { ...primaryStyle, marginLeft: 6 }, onClick: () => removeProfile(detail) }, copy.confirm))),
        detail.enabled ? h('button', { type: 'button', disabled: busy, style: buttonStyle, onClick: disable }, copy.disable) : h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => enable(detail.id) }, copy.enable))))

  return h('section', { 'data-dsh-oidc-managed-provider': 'true', style: { margin: '18px 0' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 11 } }, h('div', null, h('strong', { style: { fontSize: 14 } }, copy.title), h('p', { style: { margin: '4px 0 0', color: textSecondary, fontSize: 12, lineHeight: 1.55 } }, copy.description)), canManageProfiles && h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => { setError(''); setNotice(''); setAddOpen(true) } }, copy.add)),
    configuration.configFile ? h('div', { 'data-eduwork-config-file': true, style: { margin: '10px 0', color: textSecondary, fontSize: 12, lineHeight: 1.7, overflowWrap: 'anywhere' } },
      h('p', { style: { margin: 0 } }, copy.fileHint),
      configuration.configFile.canOpen ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 } },
        h('button', { type: 'button', style: primaryStyle, disabled: busy, onClick: () => run(() => service.openConfiguration('config'), copy.configOpened) }, copy.openConfig),
        h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: () => run(() => service.openConfiguration('examples'), copy.examplesOpened) }, copy.openExamples))
        : h('div', { style: { marginTop: 6 } }, h('div', null, copy.fileFallback, h('code', null, configuration.configFile.path)), h('div', null, copy.examplesHint)))
      : management.mode === 'profile' && h('p', { style: { margin: '8px 0', color: textTertiary, fontSize: 11 } }, copy.profileNotice),
    login.pending && h('p', { role: 'status' }, copy.waiting, ' ', h('button', { type: 'button', style: buttonStyle, onClick: login.cancel }, copy.cancelLogin)),
    error && h('p', { role: 'alert', style: { color: '#a82332', fontSize: 12 } }, error), notice && h('p', { role: 'status', style: { color: '#357a55', fontSize: 12 } }, notice),
    restartRequired && canRestart && h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, margin: '10px 0', padding: 11, border: `1px solid ${border}`, borderRadius: 10 } }, h('span', { style: { color: textSecondary, fontSize: 12 } }, copy.restartNotice), h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => run(service.restart) }, copy.restart)),
    providerCards, addDialog, detailDialog)
}
