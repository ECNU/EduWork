import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import memoryRemote from './remote.js'

declare const __EDUWORK_NATIVE_017__: boolean
const nativeSettings = typeof __EDUWORK_NATIVE_017__ !== 'undefined' && __EDUWORK_NATIVE_017__
export const inject = ['slots', 'locale', 'remote', nativeSettings ? 'configForms' : 'settingsScope']

const h = React.createElement
const NS = 'settings.localMemory'
const SETTINGS_NAMESPACE = 'memories'
const PAGE_SIZE = 10
const accent = 'var(--dsw-alias-brand-primary, #4d6bfe)'
const border = 'var(--dsw-alias-border-l2, #e4e7ee)'
const primary = 'var(--dsw-alias-label-primary, #17191c)'
const secondary = 'var(--dsw-alias-label-secondary, #6f737a)'
const panel = 'var(--dsw-alias-bg-module-platform, #f7f8fa)'

const zh = {
  nav: '个性化', title: 'Memory', intro: '让 DSH 在不同对话之间记住有用的信息。Memory 仅保存在这台设备上。',
  enable: '启用本地 Memory', enableHint: '允许 DSH 使用和生成本地 Memory。默认开启，可随时关闭。',
  search: '允许检索过往对话', searchHint: '需要连续上下文或原始依据时，在本机搜索相关对话，并保留可追溯的会话引用。不会把全部历史对话注入当前上下文。',
  external: '允许从使用工具的聊天生成 Memory', externalHint: '开启后，Web、邮件、文件和其他工具参与的聊天可以自动产生 Memory；保存的 Memory 仍会保留来源引用。',
  chat: '对话控制', chatHint: '在任一对话输入 /memories，可单独控制该对话是否使用 Memory、检索过往对话以及参与后续生成。',
  data: '本地数据', count: '已保存 {count} 条 Memory，另有 {suppressed} 条遗忘标记。', export: '导出', import: '导入', manage: '管理 Memory', closeManager: '关闭记忆管理',
  manageTitle: '目前记住的内容', manageHint: '查看和纠正语义记忆。来源仅供追溯，不能在这里修改。',
  searchMemory: '搜索 Memory', empty: '没有匹配的 Memory。', edit: '修改', save: '保存修改', cancel: '取消',
  pageStatus: '第 {page} / {pages} 页，共 {total} 条', previousPage: '上一页', nextPage: '下一页',
  retain: '保留', unretain: '取消保留', retained: '用户已保留', retainHint: '保留后不会因长期未使用或容量不足而被自动淘汰。',
  remove: '删除', removeHint: '删除当前记录；以后仍可能从新证据中重新记住。',
  forgetOne: '遗忘且不再自动记住', confirmForget: '确认遗忘', forgetHint: '删除当前记录，并阻止旧证据自动生成相同记忆。',
  undo: '撤销', undoCorrection: '撤销上次修改', corrected: '用户已纠正', source: '来源', noSource: '没有来源记录',
  updated: '修改已保存。', correctionUndone: '已撤销上次修改。', removed: 'Memory 已删除，可在 30 秒内撤销。',
  retainedNow: '此 Memory 已保留，不会被自动淘汰。', retentionRemoved: '已取消保留；此 Memory 将重新参与自动淘汰。',
  forgotten: 'Memory 已遗忘且不会从旧证据自动重建，可在 30 秒内撤销。', restored: 'Memory 已恢复。',
  delete: '删除 Memory', deleteAgain: '再次点击，删除全部', deleteHint: '永久删除这台设备上的全部语义 Memory 和遗忘标记。此操作无法撤销。',
  loading: '正在读取 Memory 设置…', unavailable: '当前连接无法维护 Memory 设置。',
  exported: 'Memory 已导出。', imported: '已导入 {imported} 条，合并 {merged} 条，跳过 {skipped} 条。', deleted: '本地 Memory 已全部删除。',
}
const en = {
  nav: 'Personalization', title: 'Memory', intro: 'Let DSH remember useful details across chats. Memory stays on this device.',
  enable: 'Enable local memories', enableHint: 'Allow DSH to use and generate local memories. On by default and always under your control.',
  search: 'Reference prior chats', searchHint: 'When continuity or primary evidence matters, search relevant chats on this device and retain a traceable conversation citation. Full history is never injected wholesale.',
  external: 'Allow local memory generation from tool-assisted chats', externalHint: 'When enabled, chats using web, mail, files, and other tools may generate memories automatically. Saved memories retain source citations.',
  chat: 'Chat controls', chatHint: 'Type /memories in any chat to control memory use, prior-chat retrieval, and whether that chat contributes to future memory generation.',
  data: 'Local data', count: '{count} memories saved, plus {suppressed} forget markers.', export: 'Export', import: 'Import', manage: 'Manage memories', closeManager: 'Close memory manager',
  manageTitle: 'What DSH remembers', manageHint: 'Review and correct semantic memories. Sources are read-only evidence.',
  searchMemory: 'Search memories', empty: 'No matching memories.', edit: 'Edit', save: 'Save changes', cancel: 'Cancel',
  pageStatus: 'Page {page} of {pages}, {total} total', previousPage: 'Previous', nextPage: 'Next',
  retain: 'Retain', unretain: 'Stop retaining', retained: 'Retained by user', retainHint: 'Retained memories are never removed for age or capacity.',
  remove: 'Delete', removeHint: 'Delete this record; new evidence may allow it to be learned again.',
  forgetOne: 'Forget and prevent relearning', confirmForget: 'Confirm forget', forgetHint: 'Delete this record and prevent old evidence from automatically recreating it.',
  undo: 'Undo', undoCorrection: 'Undo last edit', corrected: 'Corrected by user', source: 'Sources', noSource: 'No source recorded',
  updated: 'Changes saved.', correctionUndone: 'The last edit was undone.', removed: 'Memory deleted. You can undo for 30 seconds.',
  retainedNow: 'This memory is retained and will not be removed automatically.', retentionRemoved: 'Retention removed; this memory can be evicted automatically again.',
  forgotten: 'Memory forgotten and blocked from automatic relearning. You can undo for 30 seconds.', restored: 'Memory restored.',
  delete: 'Delete memories', deleteAgain: 'Click again to delete all', deleteHint: 'Permanently delete all semantic memories and forget markers on this device. This cannot be undone.',
  loading: 'Loading Memory settings…', unavailable: 'Memory settings are unavailable for this connection.',
  exported: 'Memories exported.', imported: 'Imported {imported}, merged {merged}, skipped {skipped}.', deleted: 'All local memories were deleted.',
}

function format(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template)
}

function Switch({ checked, disabled, label, onChange }) {
  return h('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled,
    onClick: () => onChange(!checked),
    style: {
      position: 'relative', flex: 'none', width: 38, height: 22, padding: 0, border: 0, borderRadius: 20,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .45 : 1,
      background: checked ? accent : 'var(--dsw-alias-fill-tertiary, #c9cdd5)', transition: 'background .16s ease',
    },
  }, h('span', { style: {
    position: 'absolute', top: 3, left: checked ? 19 : 3, width: 16, height: 16, borderRadius: '50%',
    background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'left .16s ease',
  } }))
}

function ToggleRow({ title, hint, checked, disabled, onChange, last = false }) {
  return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 28, padding: '18px 0', borderBottom: last ? 'none' : `1px solid ${border}` } },
    h('div', { style: { minWidth: 0 } },
      h('div', { style: { color: primary, fontSize: 14, fontWeight: 600, lineHeight: 1.5 } }, title),
      h('div', { style: { maxWidth: 620, marginTop: 3, color: secondary, fontSize: 12, lineHeight: 1.55 } }, hint),
    ),
    h(Switch, { checked, disabled, label: title, onChange }),
  )
}

function buttonStyle(danger = false) {
  return {
    minHeight: 34, border: `1px solid ${danger ? 'var(--dsw-alias-state-danger, #d74b4b)' : border}`,
    borderRadius: 8, padding: '6px 12px', background: 'transparent', cursor: 'pointer',
    color: danger ? 'var(--dsw-alias-state-danger, #c63b3b)' : primary, fontSize: 12, fontWeight: 600,
  }
}

function sourceText(source) {
  if (source.uri) return source.uri
  if (source.kind === 'session' && source.sessionId) return source.label || 'session'
  if (source.kind === 'tool' && source.toolName) return `${source.toolName}${source.callId ? `#${source.callId}` : ''}`
  return source.label || source.kind
}

function MemoryCard({ record, t, busy, editing, draft, forgetArmed, onEdit, onDraft, onSave, onCancel, onUndoEdit, onRetention, onDelete, onForget }) {
  const sources = (record.sources ?? []).map(sourceText).filter(Boolean).slice(0, 3)
  return h('article', { style: { padding: 14, border: `1px solid ${border}`, borderRadius: 10, background: panel } },
    h('div', { style: { display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 } },
      h('span', { style: { padding: '2px 7px', borderRadius: 999, background: 'var(--dsw-alias-fill-secondary, #e9ebef)', color: secondary, fontSize: 11 } }, record.kind),
      record.scope === 'project' && h('span', { style: { color: secondary, fontSize: 11 } }, 'project'),
      record.userEditedAt && h('span', { style: { color: accent, fontSize: 11, fontWeight: 600 } }, t('corrected')),
      record.userPinnedAt && h('span', { style: { color: accent, fontSize: 11, fontWeight: 600 } }, t('retained')),
    ),
    editing
      ? h('textarea', {
          value: draft, onChange: event => onDraft(event.currentTarget.value), maxLength: 2000,
          'aria-label': t('edit'), rows: 4,
          style: { width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 10, border: `1px solid ${border}`, borderRadius: 8, background: 'var(--dsw-alias-bg-base, #fff)', color: primary, font: 'inherit', fontSize: 13, lineHeight: 1.55 },
        })
      : h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: primary, fontSize: 13, lineHeight: 1.6 } }, record.content),
    h('div', { style: { marginTop: 9, color: secondary, fontSize: 11, lineHeight: 1.5 } },
      h('span', { style: { fontWeight: 600 } }, `${t('source')}: `),
      sources.length > 0 ? sources.join(' · ') : t('noSource'),
    ),
    h('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 } },
      editing
        ? [
            h('button', { key: 'save', type: 'button', disabled: busy !== '' || draft.trim() === '', onClick: onSave, style: buttonStyle() }, t('save')),
            h('button', { key: 'cancel', type: 'button', disabled: busy !== '', onClick: onCancel, style: buttonStyle() }, t('cancel')),
          ]
        : [
            h('button', { key: 'edit', type: 'button', disabled: busy !== '', onClick: onEdit, style: buttonStyle() }, t('edit')),
            h('button', { key: 'retain', type: 'button', title: t('retainHint'), disabled: busy !== '', onClick: onRetention, style: buttonStyle() }, record.userPinnedAt ? t('unretain') : t('retain')),
            record.previousContent && h('button', { key: 'undo-edit', type: 'button', disabled: busy !== '', onClick: onUndoEdit, style: buttonStyle() }, t('undoCorrection')),
            h('button', { key: 'delete', type: 'button', title: t('removeHint'), disabled: busy !== '', onClick: onDelete, style: buttonStyle(true) }, t('remove')),
            h('button', { key: 'forget', type: 'button', title: t('forgetHint'), disabled: busy !== '', onClick: onForget, style: buttonStyle(true) }, forgetArmed ? t('confirmForget') : t('forgetOne')),
          ],
    ),
  )
}

async function unwrap(operation) {
  const result = await operation
  if (result?.ok === true) return result.value
  throw new Error(result?.error?.message || result?.error?.code || 'Memory service unavailable')
}

function MemorySection({ t, service }) {
  const snapshot = useSyncExternalStore(
    listener => service.settings.subscribe(listener),
    () => service.settings.getSnapshot(),
    () => service.settings.getSnapshot(),
  )
  const [stats, setStats] = useState({ total: 0, suppressed: 0 })
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [managing, setManaging] = useState(false)
  const [records, setRecords] = useState({ total: 0, offset: 0, limit: PAGE_SIZE, items: [] })
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState('')
  const [forgetArmed, setForgetArmed] = useState('')
  const [undoToken, setUndoToken] = useState('')
  const fileInput = useRef(null)
  const refresh = () => service.stats().then(setStats)
  const refreshRecords = async (value = query, pageIndex = page) => {
    const request = targetPage => JSON.stringify({ query: value, offset: targetPage * PAGE_SIZE, limit: PAGE_SIZE })
    let result = await service.listRecords(request(pageIndex))
    const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1)
    if (pageIndex > lastPage) {
      setPage(lastPage)
      result = await service.listRecords(request(lastPage))
    }
    setRecords(result)
    return result
  }
  const closeManager = () => {
    setManaging(false)
    setEditingId('')
    setDraft('')
    setForgetArmed('')
  }

  useEffect(() => { refresh().catch(cause => setError(String(cause?.message ?? cause))) }, [])
  useEffect(() => {
    if (!deleteArmed) return
    const timer = window.setTimeout(() => setDeleteArmed(false), 5000)
    return () => window.clearTimeout(timer)
  }, [deleteArmed])
  useEffect(() => {
    if (!forgetArmed) return
    const timer = window.setTimeout(() => setForgetArmed(''), 5000)
    return () => window.clearTimeout(timer)
  }, [forgetArmed])
  useEffect(() => {
    if (!managing) return
    const timer = window.setTimeout(() => {
      refreshRecords(query, page).catch(cause => setError(String(cause?.message ?? cause)))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [managing, query, page])
  useEffect(() => {
    if (!managing) return
    const onKeyDown = event => { if (event.key === 'Escape') closeManager() }
    window.document.addEventListener('keydown', onKeyDown)
    return () => window.document.removeEventListener('keydown', onKeyDown)
  }, [managing])

  if (snapshot.status === 'loading') return h('div', { style: { padding: '12px 0' } }, t('loading'))
  if (snapshot.status !== 'ready') return h('p', { role: 'alert' }, t('unavailable'))
  const values = snapshot.value ?? {}
  const enabled = values.enabled === true
  const search = values.search_prior_chats !== false
  const external = values.disable_on_external_context === false
  const writable = snapshot.writable === true

  const run = async (key, action, success) => {
    setBusy(key); setError(''); setMessage('')
    try {
      await action()
      if (success) setMessage(success)
      await refresh()
      if (managing) await refreshRecords(query, page)
      return true
    }
    catch (cause) { setError(String(cause?.message ?? cause)); return false }
    finally { setBusy('') }
  }
  const exportData = () => run('export', async () => {
    const document = await service.exportData()
    const blob = new Blob([document], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `dsh-local-memory-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, t('exported'))
  const importData = event => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    void run('import', async () => {
      const result = await service.importData(await file.text())
      setMessage(format(t('imported'), result))
    })
  }
  const deleteAll = () => {
    if (!deleteArmed) { setDeleteArmed(true); return }
    setDeleteArmed(false)
    void run('delete', () => service.deleteAll('delete-local-memories'), t('deleted'))
  }
  const editRecord = record => { setEditingId(record.id); setDraft(record.content); setForgetArmed('') }
  const saveRecord = record => {
    void run(`edit:${record.id}`, () => service.updateRecord(JSON.stringify({ id: record.id, content: draft })), t('updated'))
      .then(saved => { if (saved) { setEditingId(''); setDraft('') } })
  }
  const undoRecordUpdate = record => {
    void run(`undo-edit:${record.id}`, () => service.undoRecordUpdate(record.id), t('correctionUndone'))
  }
  const setRecordRetention = record => {
    const pinned = !record.userPinnedAt
    void run(`retain:${record.id}`, () => service.setRecordPinned(JSON.stringify({ id: record.id, pinned })), pinned ? t('retainedNow') : t('retentionRemoved'))
  }
  const removeRecord = (record, mode) => {
    if (mode === 'forget' && forgetArmed !== record.id) { setForgetArmed(record.id); return }
    setForgetArmed('')
    void run(`${mode}:${record.id}`, async () => {
      const result = await service.deleteRecord(JSON.stringify({ id: record.id, mode }))
      setUndoToken(result.undoToken || '')
      setEditingId('')
      setDraft('')
    }, mode === 'forget' ? t('forgotten') : t('removed'))
  }
  const undoDelete = () => {
    const token = undoToken
    if (!token) return
    void run('undo-delete', async () => {
      await service.undoDelete(token)
      setUndoToken('')
    }, t('restored'))
  }

  return h('div', { style: { width: '100%', maxWidth: 760, color: primary } },
    h('div', { style: { marginBottom: 22 } },
      h('div', null,
        h('h2', { style: { margin: '0 0 6px', fontSize: 21, lineHeight: 1.3 } }, t('title')),
        h('p', { style: { margin: 0, color: secondary, fontSize: 13, lineHeight: 1.6 } }, t('intro')),
      ),
    ),
    h('section', { style: { padding: '0 18px', border: `1px solid ${border}`, borderRadius: 12, background: panel } },
      h(ToggleRow, { title: t('enable'), hint: t('enableHint'), checked: enabled, disabled: !writable || busy !== '', onChange: value => { void service.settings.set('enabled', value) } }),
      h(ToggleRow, { title: t('search'), hint: t('searchHint'), checked: search, disabled: !writable || !enabled || busy !== '', onChange: value => { void service.settings.set('search_prior_chats', value) } }),
      h(ToggleRow, { title: t('external'), hint: t('externalHint'), checked: external, disabled: !writable || !enabled || busy !== '', last: true, onChange: value => { void service.settings.set('disable_on_external_context', !value) } }),
    ),
    h('section', { style: { marginTop: 24 } },
      h('h3', { style: { margin: '0 0 5px', fontSize: 14 } }, t('chat')),
      h('p', { style: { margin: 0, color: secondary, fontSize: 12, lineHeight: 1.6 } }, t('chatHint')),
    ),
    h('section', { style: { marginTop: 24, paddingTop: 20, borderTop: `1px solid ${border}` } },
      h('h3', { style: { margin: '0 0 5px', fontSize: 14 } }, t('data')),
      h('p', { style: { margin: '0 0 12px', color: secondary, fontSize: 12 } }, format(t('count'), { count: stats.total, suppressed: stats.suppressed })),
      h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        h('button', { type: 'button', disabled: busy !== '', onClick: () => { setPage(0); setManaging(true) }, style: buttonStyle() }, t('manage')),
        h('button', { type: 'button', disabled: busy !== '', onClick: exportData, style: buttonStyle() }, t('export')),
        h('button', { type: 'button', disabled: busy !== '', onClick: () => fileInput.current?.click(), style: buttonStyle() }, t('import')),
        h('input', { ref: fileInput, type: 'file', accept: 'application/json,.json', hidden: true, onChange: importData }),
      ),
    ),
    h('section', { style: { marginTop: 24, padding: '16px 18px', border: '1px solid color-mix(in srgb, var(--dsw-alias-state-danger, #d74b4b) 35%, transparent)', borderRadius: 12 } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 22 } },
        h('div', null,
          h('div', { style: { fontSize: 13, fontWeight: 650 } }, t('delete')),
          h('div', { style: { marginTop: 3, color: secondary, fontSize: 12, lineHeight: 1.5 } }, t('deleteHint')),
        ),
        h('button', { type: 'button', disabled: busy !== '' || stats.total + stats.suppressed === 0, onClick: deleteAll, style: buttonStyle(true) }, deleteArmed ? t('deleteAgain') : t('delete')),
      ),
    ),
    !managing && error && h('p', { role: 'alert', style: { color: 'var(--dsw-alias-state-danger, #c63b3b)', fontSize: 12 } }, error),
    !managing && message && h('div', { role: 'status', style: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-state-success, #2b8057)', fontSize: 12 } },
      h('span', null, message),
      undoToken && h('button', { type: 'button', disabled: busy !== '', onClick: undoDelete, style: buttonStyle() }, t('undo')),
    ),
    managing && h('div', {
      role: 'presentation', onMouseDown: event => { if (event.target === event.currentTarget) closeManager() },
      style: { position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box', background: 'rgba(18, 20, 24, .46)' },
    }, h('section', {
      role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'dsh-memory-manager-title',
      style: { width: 'min(920px, calc(100vw - 32px))', height: 'min(760px, calc(100vh - 48px))', minHeight: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${border}`, borderRadius: 16, background: 'var(--dsw-alias-bg-base, #fff)', boxShadow: '0 24px 70px rgba(0, 0, 0, .24)' },
    },
      h('header', { style: { flex: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, padding: '20px 22px 14px' } },
        h('div', { style: { minWidth: 0 } },
          h('h3', { id: 'dsh-memory-manager-title', style: { margin: '0 0 5px', fontSize: 17, lineHeight: 1.35 } }, t('manageTitle')),
          h('p', { style: { margin: 0, color: secondary, fontSize: 12, lineHeight: 1.55 } }, t('manageHint')),
        ),
        h('button', {
          type: 'button', 'aria-label': t('closeManager'), onClick: closeManager,
          style: { flex: 'none', width: 32, height: 32, padding: 0, border: `1px solid ${border}`, borderRadius: 8, background: 'transparent', color: primary, cursor: 'pointer', fontSize: 20, lineHeight: 1 },
        }, '×'),
      ),
      h('div', { style: { flex: 'none', padding: '0 22px 14px' } },
        h('input', {
          type: 'search', value: query, placeholder: t('searchMemory'), 'aria-label': t('searchMemory'),
          onChange: event => { setQuery(event.currentTarget.value); setPage(0) },
          style: { width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: `1px solid ${border}`, borderRadius: 8, background: panel, color: primary, fontSize: 12 },
        }),
      ),
      (error || message) && h('div', { style: { flex: 'none', padding: '0 22px 12px' } },
        error && h('p', { role: 'alert', style: { margin: 0, color: 'var(--dsw-alias-state-danger, #c63b3b)', fontSize: 12 } }, error),
        message && h('div', { role: 'status', style: { display: 'flex', alignItems: 'center', gap: 8, color: 'var(--dsw-alias-state-success, #2b8057)', fontSize: 12 } },
          h('span', null, message),
          undoToken && h('button', { type: 'button', disabled: busy !== '', onClick: undoDelete, style: buttonStyle() }, t('undo')),
        ),
      ),
      h('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 22px 16px' } },
        records.items.length === 0
          ? h('p', { style: { margin: '18px 0', color: secondary, fontSize: 12 } }, t('empty'))
          : h('div', { style: { display: 'grid', gap: 10 } }, records.items.map(record => h(MemoryCard, {
              key: record.id, record, t, busy, editing: editingId === record.id, draft,
              forgetArmed: forgetArmed === record.id,
              onEdit: () => editRecord(record), onDraft: setDraft, onSave: () => saveRecord(record),
              onCancel: () => { setEditingId(''); setDraft('') }, onUndoEdit: () => undoRecordUpdate(record),
              onRetention: () => setRecordRetention(record),
              onDelete: () => removeRecord(record, 'delete'), onForget: () => removeRecord(record, 'forget'),
            }))),
      ),
      h('footer', { style: { flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '12px 22px', borderTop: `1px solid ${border}`, background: panel } },
        h('span', { style: { color: secondary, fontSize: 12 } }, format(t('pageStatus'), { page: records.total === 0 ? 0 : page + 1, pages: Math.ceil(records.total / PAGE_SIZE), total: records.total })),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', {
            type: 'button', disabled: busy !== '' || page === 0, onClick: () => setPage(value => Math.max(0, value - 1)),
            style: { ...buttonStyle(), opacity: busy !== '' || page === 0 ? .45 : 1, cursor: busy !== '' || page === 0 ? 'not-allowed' : 'pointer' },
          }, t('previousPage')),
          h('button', {
            type: 'button', disabled: busy !== '' || (page + 1) * PAGE_SIZE >= records.total, onClick: () => setPage(value => value + 1),
            style: { ...buttonStyle(), opacity: busy !== '' || (page + 1) * PAGE_SIZE >= records.total ? .45 : 1, cursor: busy !== '' || (page + 1) * PAGE_SIZE >= records.total ? 'not-allowed' : 'pointer' },
          }, t('nextPage')),
        ),
      ),
    )),
  )
}

export async function apply(ctx) {
  const disposeRemote = await ctx.remote.$mount(memoryRemote)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'memory-native: personalization dictionaries')
  ctx.inject(['remote.localMemories'], surface => {
    const settings = (nativeSettings ? surface.configForms.get(SETTINGS_NAMESPACE) : surface.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }))
    const service = {
      settings,
      stats: () => unwrap(surface.remote.localMemories.stats()),
      listRecords: request => unwrap(surface.remote.localMemories.listRecords(request)),
      updateRecord: request => unwrap(surface.remote.localMemories.updateRecord(request)),
      setRecordPinned: request => unwrap(surface.remote.localMemories.setRecordPinned(request)),
      undoRecordUpdate: id => unwrap(surface.remote.localMemories.undoRecordUpdate(id)),
      deleteRecord: request => unwrap(surface.remote.localMemories.deleteRecord(request)),
      undoDelete: token => unwrap(surface.remote.localMemories.undoDelete(token)),
      deleteAll: confirmation => unwrap(surface.remote.localMemories.deleteAll(confirmation)),
      exportData: () => unwrap(surface.remote.localMemories.exportData()),
      importData: document => unwrap(surface.remote.localMemories.importData(document)),
    }
    surface.slots.inject('settings.section', () => surface.slots.register({
      name: 'settings.section', id: 'personalization', order: 15,
      label: () => surface.locale.bind(NS)('nav'), locale: NS,
      inject: () => ({ service }),
    }, MemorySection))
  })
  return async () => { await disposeRemote() }
}

export { MemorySection }
