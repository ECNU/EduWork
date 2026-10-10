import React, { useEffect, useState } from 'react'
import { modelCapabilitySummary, reasoningEffortOrder, runtimeModelDraft, serializeRuntimeModelDraft } from './presentation.js'

import { useSignIn } from './use-sign-in.js'

const h = React.createElement
const border = 'var(--dsw-alias-border-l2, #e8d9d2)'
const textPrimary = 'var(--dsw-alias-label-primary, #231a17)'
const textSecondary = 'var(--dsw-alias-label-secondary, #75635c)'
const textTertiary = 'var(--dsw-alias-label-tertiary, #8a766f)'
const background = 'var(--dsw-alias-bg-layer-1, #fffdfb)'


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

export function ManagedProviderCard({ t, service, configuration }: any) {
  const sourceLabel = (value: string) => ({
    preset: t('managed.sourcePreset'), discovered: t('managed.sourceDiscovered'),
    discovery: t('managed.sourcePending'), manual: t('managed.sourceManual'),
    profile: t('managed.profileManaged'),
  } as Record<string, string>)[value] || (t('managed.sourceProvider'))
  const capabilityLabel = (value: string) => ({ off: t('managed.effortOff'), minimal: t('managed.effortMinimal'), low: t('managed.effortLow'), medium: t('managed.effortMedium'), high: t('managed.effortHigh'), xhigh: t('managed.effortExtraHigh'), max: 'Max' } as Record<string, string>)[value] || value
  const modalityLabel = (value: string) => ({ text: t('managed.modalityText'), image: t('managed.modalityImage'), audio: t('managed.modalityAudio'), video: t('managed.modalityVideo') } as Record<string, string>)[value] || value


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
  const connect = (profileID: string) => signIn(profileID)

  if (!management) return h('p', { style: { margin: '18px 0', color: textSecondary, fontSize: 12 } }, t('managed.loading'))
  const canManageProfiles = !configuration.configFile && management.capabilities.manageProfiles === true
  const canManageModels = !configuration.configFile && management.capabilities.manageModels === true
  const noModelsNotice = configuration.configFile
    ? (t('managed.fileModelsHint')) : t('managed.noModels')
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
      ? [h('span', { key: 'identity', style: { color: textSecondary, fontSize: 11 } }, t('managed.identityOnly'))]
      : profile.runtime.models.length > 0
      ? profile.runtime.models.map((model: any) => h('code', { key: model.id, style: { borderRadius: 6, padding: '3px 7px', background: 'var(--dsw-alias-bg-layer-2, #f6f1ee)', color: textSecondary, fontSize: 11 } }, model.id))
      : [h('span', { key: 'empty', style: { color: textTertiary, fontSize: 11 } }, noModelsNotice)]
    return h('article', { key: profile.id, style: { border: `1px solid ${profile.enabled ? accent : border}`, borderRadius: 13, background, padding: 15 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 } },
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
            h('strong', { style: { fontSize: 15 } }, profile.displayName),
            h('span', { style: { borderRadius: 999, padding: '2px 7px', background: 'var(--dsw-alias-bg-layer-2, #eef1f6)', color: textSecondary, fontSize: 11 } }, configuration.configFile ? (t('managed.configurationFile')) : profile.builtIn ? t('managed.verified') : t('managed.custom')),
            h('span', { style: { borderRadius: 999, padding: '2px 7px', border: `1px solid ${connected ? 'var(--dsw-alias-state-success-primary, #357a55)' : border}`, color: connected ? 'var(--dsw-alias-state-success-primary, #357a55)' : profile.enabled ? accent : textTertiary, fontSize: 11 } }, connected ? t('managed.connected') : profile.enabled ? t('managed.enabled') : t('managed.disabled'))),
          h('div', { style: { marginTop: 6, color: textSecondary, fontSize: 11, overflowWrap: 'anywhere' } }, profile.baseURL),
          h('div', { style: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' } }, ...modelBadges)),
        h('div', { style: { display: 'flex', gap: 7, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' } },
          h('button', { type: 'button', disabled: busy, style: buttonStyle, onClick: () => openDetail(profile) }, canManageProfiles || canManageModels ? t('managed.configure') : (t('managed.viewDetails'))),
          canManageProfiles && !profile.enabled && h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => enable(profile.id) }, t('managed.enable')),
          profile.enabled && !restartRequired && !connected && h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => connect(profile.id) }, busy ? t('managed.processing') : t('managed.login')),
          profile.enabled && !restartRequired && connected && h('button', { type: 'button', disabled: busy, style: buttonStyle, onClick: () => run(() => service.reconcile(profile.id, {})) }, t('managed.refresh')))))
  })) : h('div', { style: { padding: 18, border: `1px dashed ${border}`, borderRadius: 13, background } },
    h('strong', { style: { display: 'block', fontSize: 14 } }, t('managed.emptyTitle')),
    h('p', { style: { margin: '6px 0 0', color: textSecondary, fontSize: 12, lineHeight: 1.55 } }, configuration.configFile
      ? (t('managed.fileEmptyHint')) : t('managed.emptyHint')))

  const addDialog = addOpen && h('div', { style: panelStyle, onMouseDown: (event: any) => { if (event.target === event.currentTarget && !busy) setAddOpen(false) } },
    h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('managed.addTitle'), style: { ...cardStyle, width: 'min(660px, calc(100vw - 40px))' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14 } },
        h('div', null, h('h2', { style: { margin: '0 0 4px', fontSize: 22 } }, t('managed.addTitle')), h('p', { style: { margin: 0, color: textSecondary, fontSize: 12 } }, t('managed.addDescription'))),
        h('button', { type: 'button', disabled: busy, 'aria-label': t('managed.close'), onClick: () => setAddOpen(false), style: buttonStyle }, '×')),
      available.length > 0 && h('div', { style: { display: 'grid', gap: 8, marginTop: 18 } }, ...available.map((profile: any) => h('article', { key: profile.id, style: { display: 'flex', justifyContent: 'space-between', gap: 14, border: `1px solid ${border}`, borderRadius: 11, padding: 13 } },
        h('div', null, h('strong', null, profile.displayName), h('div', { style: { marginTop: 4, color: textTertiary, fontSize: 11 } }, profile.baseURL)),
        h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => run(() => service.configure(profile.id)).then(() => setAddOpen(false)) }, t('managed.addVerified'))))),
      h('form', { onSubmit: addCustom, style: { marginTop: 20, paddingTop: 17, borderTop: `1px solid ${border}` } },
        h('strong', { style: { display: 'block', fontSize: 13 } }, t('managed.compatible')),
        h('p', { style: { margin: '5px 0 10px', color: textSecondary, fontSize: 12 } }, t('managed.compatibleHint')),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { type: 'url', required: true, value: baseURL, placeholder: 'https://ai.example.edu', onChange: (event: any) => setBaseURL(event.currentTarget.value), style: inputStyle }),
          h('button', { type: 'submit', disabled: busy, style: primaryStyle }, busy ? t('managed.saving') : t('managed.saveService'))))))

  const modelEditors = modelDrafts.map((draft, index) => h('article', {
    key: index, style: { border: `1px solid ${border}`, borderRadius: 11, padding: 13 },
  },
  h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 10 } },
    h('strong', null, `${t('managed.model')} ${index + 1}`),
    modelDrafts.length > 1 && h('button', { type: 'button', style: buttonStyle, onClick: () => setModelDrafts(current => current.filter((_, candidate) => candidate !== index)) }, t('managed.remove'))),
  h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 } },
    ...[[t('managed.modelID'), 'id'], [t('managed.displayName'), 'name'], [t('managed.baseModelID'), 'upstreamModelID'], [t('managed.contextWindow'), 'contextWindow'], [t('managed.maxOutput'), 'maxTokens']]
      .map(([label, field]) => h('label', { key: field, style: { fontSize: 11 } }, label,
        h('input', { required: field === 'id', value: draft[field], onChange: (event: any) => updateDraft(index, { [field]: event.currentTarget.value }), style: { ...inputStyle, marginTop: 5 } })))),
  h('div', { style: { marginTop: 10, fontSize: 11 } },
    h('span', { style: { marginRight: 10, color: textSecondary } }, t('managed.modalities')),
    ...['text', 'image', 'audio', 'video'].map(value => h('label', { key: value, style: { marginRight: 11 } },
      h('input', { type: 'checkbox', checked: draft.input.includes(value), onChange: () => toggleDraft(index, 'input', value) }), ` ${modalityLabel(value)}`))),
  h('div', { style: { marginTop: 8, fontSize: 11 } },
    h('span', { style: { marginRight: 10, color: textSecondary } }, t('managed.reasoningLevels')),
    h('label', { style: { marginRight: 12 } }, h('input', { type: 'checkbox', checked: draft.reasoningSupported, onChange: (event: any) => updateDraft(index, { reasoningSupported: event.currentTarget.checked, reasoning: event.currentTarget.checked ? draft.reasoning : [] }) }), ` ${t('managed.supportsReasoning')}`),
    ...(draft.reasoningSupported ? reasoningEffortOrder.map(value => h('label', { key: value, style: { marginRight: 11 } },
      h('input', { type: 'checkbox', checked: draft.reasoning.includes(value), onChange: () => toggleDraft(index, 'reasoning', value) }), ` ${capabilityLabel(value)}`)) : [])),
  draft.reasoningSupported && draft.reasoning.length > 0 && h('label', { style: { display: 'block', marginTop: 9, fontSize: 11 } }, t('managed.defaultReasoning'),
    h('select', { value: draft.reasoning.includes(draft.defaultReasoningEffort) ? draft.defaultReasoningEffort : '', onChange: (event: any) => updateDraft(index, { defaultReasoningEffort: event.currentTarget.value }), style: { ...inputStyle, marginTop: 5 } },
      h('option', { value: '' }, t('managed.decidedByService')),
      ...draft.reasoning.slice().sort((left: string, right: string) => reasoningEffortOrder.indexOf(left) - reasoningEffortOrder.indexOf(right)).map((value: string) => h('option', { key: value, value }, capabilityLabel(value)))))))

  const detailDialog = detail && h('div', { style: panelStyle, onMouseDown: (event: any) => { if (event.target === event.currentTarget && !busy) setDetailID('') } },
    h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `${detail.displayName} ${t('managed.configure')}`, style: cardStyle },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14 } },
        h('div', { style: { minWidth: 0 } }, h('h2', { style: { margin: '0 0 4px', fontSize: 22 } }, detail.displayName), h('p', { style: { margin: 0, color: textSecondary, fontSize: 12, overflowWrap: 'anywhere' } }, `${detail.organization} · ${detail.baseURL}`)),
        h('button', { type: 'button', disabled: busy, 'aria-label': t('managed.close'), onClick: () => setDetailID(''), style: buttonStyle }, '×')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8, marginTop: 17 } },
        ...[[t('managed.providerID'), detail.providerID], [t('managed.modelCatalog'), sourceLabel(detail.runtime.modelSource)], [t('managed.defaultContext'), modelCapabilitySummary({}, detail.runtime).contextWindow], [t('managed.defaultOutput'), modelCapabilitySummary({}, detail.runtime).maxTokens]].map(([label, value]) => h('div', { key: label, style: { border: `1px solid ${border}`, borderRadius: 9, padding: 10 } }, h('span', { style: { display: 'block', color: textTertiary, fontSize: 10 } }, label), h('strong', { style: { display: 'block', marginTop: 4, fontSize: 12 } }, value || t('managed.unspecified'))))),
      canManageProfiles && !detail.builtIn && h('form', { onSubmit: updateCustom, style: { marginTop: 16, padding: 12, border: `1px solid ${border}`, borderRadius: 10 } },
        h('strong', { style: { fontSize: 12 } }, t('managed.editAddress')), h('p', { style: { margin: '4px 0 9px', color: textTertiary, fontSize: 11 } }, t('managed.editAddressHint')),
        h('div', { style: { display: 'flex', gap: 8 } }, h('input', { type: 'url', required: true, value: editBaseURL, onChange: (event: any) => setEditBaseURL(event.currentTarget.value), style: inputStyle }), h('button', { type: 'submit', disabled: busy || editBaseURL === detail.baseURL, style: buttonStyle }, t('managed.save')))),
      h('div', { style: { marginTop: 20, display: 'flex', justifyContent: 'space-between', gap: 12 } },
        h('div', null, h('strong', { style: { fontSize: 14 } }, t('managed.modelCapability')), h('p', { style: { margin: '4px 0 0', color: textTertiary, fontSize: 11 } }, canManageModels && !detail.builtIn ? t('managed.customModels') : t('managed.readonlyModels'))),
        canManageModels && !detail.builtIn && h('div', { style: { display: 'flex', gap: 7 } },
          h('button', { type: 'button', disabled: busy, style: buttonStyle, onClick: useDiscovery }, t('managed.automatic')),
          h('button', { type: 'button', disabled: busy, style: editingModels ? primaryStyle : buttonStyle, onClick: () => { setModelDrafts(detail.runtime.models.map(runtimeModelDraft).concat(detail.runtime.models.length ? [] : [runtimeModelDraft()])); setEditingModels(true) } }, t('managed.manual')))),
      !editingModels && h('div', { style: { display: 'grid', gap: 9, marginTop: 11 } }, ...(detail.runtime.models.length > 0 ? detail.runtime.models.map((model: any) => {
        const summary = modelCapabilitySummary(model, detail.runtime)
        return h('article', { key: model.id, style: { border: `1px solid ${border}`, borderRadius: 11, padding: 13 } },
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, h('strong', null, summary.name), summary.name !== summary.id && h('code', { style: { color: textTertiary, fontSize: 11 } }, summary.id), summary.multimodal && h('span', { style: { color: 'var(--dsw-alias-state-business-primary, #355c91)', fontSize: 10 } }, t('managed.multimodal'))),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))', gap: 8, marginTop: 10, color: textSecondary, fontSize: 11 } },
            summary.upstreamModelID && h('span', null, `${t('managed.baseModel')}：${summary.upstreamModelID}`), h('span', null, `${t('managed.context')}：${summary.contextWindow || t('managed.unspecified')}`), h('span', null, `${t('managed.output')}：${summary.maxTokens || t('managed.unspecified')}`),
            h('span', null, `${t('managed.input')}：${summary.input.map(modalityLabel).join('、')}`), h('span', null, `${t('managed.reasoning')}：${!summary.reasoningSupported ? t('managed.unsupported') : summary.reasoningEfforts.length ? summary.reasoningEfforts.map(capabilityLabel).join('、') : t('managed.decidedByService')}`)))
      }) : [h('div', { key: 'empty', style: { border: `1px dashed ${border}`, borderRadius: 11, padding: 14, color: textTertiary, fontSize: 12 } }, noModelsNotice)])),
      editingModels && h('form', { onSubmit: saveModels, style: { marginTop: 11 } },
        h('div', { style: { display: 'grid', gap: 10 } }, ...modelEditors),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 11 } },
          h('button', { type: 'button', style: buttonStyle, onClick: () => setModelDrafts(current => [...current, runtimeModelDraft()]) }, t('managed.addModel')),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('button', { type: 'button', style: buttonStyle, onClick: () => setEditingModels(false) }, t('managed.cancel')),
            h('button', { type: 'submit', disabled: busy, style: primaryStyle }, t('managed.saveModels'))))),
      canManageProfiles && h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${border}` } },
        h('div', null, removeConfirmID === detail.id ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary, #a82332)', fontSize: 11 } }, detail.builtIn ? t('managed.confirmRemove') : t('managed.confirmDelete')) : h('button', { type: 'button', disabled: busy, style: { ...buttonStyle, color: 'var(--dsw-alias-state-error-primary, #a82332)' }, onClick: () => setRemoveConfirmID(detail.id) }, detail.builtIn ? t('managed.removeService') : t('managed.deleteService')), removeConfirmID === detail.id && h('span', { style: { marginLeft: 8 } }, h('button', { type: 'button', style: buttonStyle, onClick: () => setRemoveConfirmID('') }, t('managed.cancel')), h('button', { type: 'button', style: { ...primaryStyle, marginLeft: 6 }, onClick: () => removeProfile(detail) }, t('managed.confirm')))),
        detail.enabled ? h('button', { type: 'button', disabled: busy, style: buttonStyle, onClick: disable }, t('managed.disable')) : h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => enable(detail.id) }, t('managed.enable')))))

  return h('section', { 'data-dsh-oidc-managed-provider': 'true', style: { margin: '18px 0' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 11 } }, h('div', null, h('strong', { style: { fontSize: 14 } }, t('managed.title')), h('p', { style: { margin: '4px 0 0', color: textSecondary, fontSize: 12, lineHeight: 1.55 } }, t('managed.description'))), canManageProfiles && h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => { setError(''); setNotice(''); setAddOpen(true) } }, t('managed.add'))),
    configuration.configFile ? h('div', { 'data-eduwork-config-file': true, style: { margin: '10px 0', color: textSecondary, fontSize: 12, lineHeight: 1.7, overflowWrap: 'anywhere' } },
      h('p', { style: { margin: 0 } }, t('managed.fileHint')),
      configuration.configFile.canOpen ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 } },
        h('button', { type: 'button', style: primaryStyle, disabled: busy, onClick: () => run(() => service.openConfiguration('config'), t('managed.configOpened')) }, t('managed.openConfig')),
        h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: () => run(() => service.openConfiguration('examples'), t('managed.examplesOpened')) }, t('managed.openExamples')))
        : h('div', { style: { marginTop: 6 } }, h('div', null, t('managed.fileFallback'), h('code', null, configuration.configFile.path)), h('div', null, t('managed.examplesHint'))))
      : management.mode === 'profile' && h('p', { style: { margin: '8px 0', color: textTertiary, fontSize: 11 } }, t('managed.profileNotice')),
    login.pending && h('p', { role: 'status' }, t('managed.waiting'), ' ', h('button', { type: 'button', style: buttonStyle, onClick: login.cancel }, t('managed.cancelLogin'))),
    error && h('p', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary, #a82332)', fontSize: 12 } }, error), notice && h('p', { role: 'status', style: { color: 'var(--dsw-alias-state-success-primary, #357a55)', fontSize: 12 } }, notice),
    restartRequired && canRestart && h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, margin: '10px 0', padding: 11, border: `1px solid ${border}`, borderRadius: 10 } }, h('span', { style: { color: textSecondary, fontSize: 12 } }, t('managed.restartNotice')), h('button', { type: 'button', disabled: busy, style: primaryStyle, onClick: () => run(service.restart) }, t('managed.restart'))),
    providerCards, addDialog, detailDialog)
}
