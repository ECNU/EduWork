import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'

const border = '1px solid var(--dsw-alias-border-l2, #0000001f)'
const control = { width: '100%', boxSizing: 'border-box' as const, padding: '7px 8px', borderRadius: 8,
  border, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #222)', font: 'inherit' }
const modes = (once: boolean) => [...(once ? [['inherit', '沿用整条日程']] : []), ['custom', '填写内容'], ['off', '不显示内容']]
const fieldNames = ['note', 'remark', 'hidden', 'reminder'] as const

/** Read a resolved note, with a fallback for clients reading an older occurrence shape. */
export function occurrenceNote(index: Map<string, string>, occurrence: any) {
  const base = `${occurrence.source ?? 'manual'}\u0000${occurrence.uid}\u0000`
  return index?.get(base + occurrence.originalStart) ?? index?.get(base) ?? ''
}

function draftOf(own: any, effective: any, once: boolean) {
  const text = (field: string) => ({ mode: own[field]?.off ? 'off' : own[field] ? 'custom' : once ? 'inherit' : 'off',
    text: effective[field]?.text ?? '' })
  const reminder = own.reminder
  return { note: text('note'), remark: text('remark'),
    hidden: own.hidden === undefined ? once ? 'inherit' : 'show' : own.hidden ? 'hide' : 'show',
    reminder: { mode: reminder?.off ? 'off' : reminder?.kind ?? (once ? 'inherit' : 'off'),
      minutes: String(effective.reminder?.minutes ?? 15), at: effective.reminder?.at ?? '' } }
}

/** One editor for both series defaults and occurrence overrides. */
export function PersonalSettings({ identity, service, run, Field, allowOccurrence = true }: any) {
  const [target, setTarget] = useState(allowOccurrence && identity.originalStart ? 'once' : 'series')
  const [form, setForm] = useState<any>(null)
  const [baseline, setBaseline] = useState<any>(null)
  const [effective, setEffective] = useState<any>({})
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const once = target === 'once'
  const ref = { scope: identity.scope ?? 'source', source: identity.source ?? 'manual', uid: identity.uid,
    ...(once ? { originalStart: identity.originalStart } : {}) }
  const key = JSON.stringify(ref)
  const load = useCallback(async () => {
    const [records, resolved] = await Promise.all([service.notes(ref), service.personalFor(ref)])
    const own = records.find((row: any) => row.originalStart === ref.originalStart) ?? {}
    return { resolved, draft: draftOf(own, resolved, once) }
  }, [service, key])
  // Each target has its own loader identity, including switching away and back.
  // A late save must never reset the editor for a different target or mount.
  const currentLoad = useRef<typeof load | null>(load)
  currentLoad.current = load
  useEffect(() => {
    let active = true
    setForm(null)
    setProblem('')
    setBusy(false)
    load().then(({ resolved, draft }) => { if (active) { setForm(draft); setBaseline(draft); setEffective(resolved) } })
      .catch(error => { if (active) setProblem(String(error.message ?? error)) })
    return () => { active = false; if (currentLoad.current === load) currentLoad.current = null }
  }, [load])
  const change = (field: string, value: any) => setForm({ ...form, [field]: value })
  const select = (label: string, value: string, options: string[][], onChange: (value: string) => void) =>
    React.createElement(Field, { label }, React.createElement('select', { 'aria-label': label, value, style: control,
      onChange: (event: any) => onChange(event.target.value) },
      ...options.map(([value, label]) => React.createElement('option', { key: value, value }, label))))
  const save = async () => {
    if (busy || !form) return
    setProblem('')
    if (form.reminder.mode === 'relative' && (form.reminder.minutes.trim() === '' || !Number.isInteger(Number(form.reminder.minutes)) || Number(form.reminder.minutes) < 0 || Number(form.reminder.minutes) > 525600)) {
      setProblem('提前分钟数请填写 0 到 525600 的整数'); return
    }
    if (form.reminder.mode === 'fixed' && !form.reminder.at) { setProblem('请选择固定提醒时间'); return }
    const patch: any = {}, clear: string[] = []
    for (const field of fieldNames) {
      if (JSON.stringify(form[field]) === JSON.stringify(baseline[field])) continue
      const value = form[field]
      const mode = field === 'hidden' ? value : value.mode
      if (mode === 'inherit') clear.push(field)
      else if (field === 'hidden') patch.hidden = mode === 'hide'
      else if (mode === 'off') patch[field] = { off: true }
      else if (field === 'reminder') patch.reminder = mode === 'relative'
        ? { kind: 'relative', minutes: Number(value.minutes) } : { kind: 'fixed', at: value.at }
      else patch[field] = { text: value.text }
    }
    setBusy(true)
    try {
      if (await run(() => service.setPersonal({ ...ref, patch, clear }), '个人设置已保存')) {
        if (currentLoad.current !== load) return
        const { draft, resolved } = await load()
        if (currentLoad.current !== load) return
        setBaseline(draft)
        // The closure's form is the submitted snapshot. Confirm only fields
        // unchanged since then, keeping later input as an unsaved draft.
        setForm((current: any) => current && Object.fromEntries(fieldNames.map(field => [field,
          JSON.stringify(current[field]) === JSON.stringify(form[field]) ? draft[field] : current[field],
        ])))
        setEffective(resolved)
      }
    } catch (error: any) { if (currentLoad.current === load) setProblem(error.message) }
    finally { if (currentLoad.current === load) setBusy(false) }
  }
  const textField = (field: 'note' | 'remark', label: string) => React.createElement('div', { key: field },
    select(`${label}设置`, form[field].mode, modes(once), mode => change(field, { ...form[field], mode })),
    form[field].mode === 'custom' ? React.createElement(Field, { label: field === 'note' ? '默认笔记' : '我的备注' },
      React.createElement('textarea', { 'aria-label': field === 'note' ? '默认笔记' : '我的备注', style: control, rows: 3,
        value: form[field].text, onChange: (event: any) => change(field, { ...form[field], text: event.target.value }) })) : undefined)
  return React.createElement('section', { 'aria-label': '个人设置', style: { padding: 12, borderRadius: 10, border,
    background: 'var(--dsw-alias-bg-layer-2, #f6f6f6)', fontSize: 13 } },
    React.createElement('strong', null, '个人设置'),
    React.createElement('p', { style: { color: 'var(--dsw-alias-label-secondary, #666)', fontSize: 12 } },
      '笔记、备注和隐藏仅保存在本机。提前提醒随改期调整、停课取消；固定时间提醒独立保留。到点后进入提醒记录，桌面端支持系统通知。需保持 EduWork 运行，不会启动模型。'),
    allowOccurrence && identity.originalStart ? select('设置范围', target, [['once', '仅这一次'], ['series', '整条日程']], setTarget) : undefined,
    !form ? React.createElement('p', null, problem || '正在读取个人设置…') : React.createElement(React.Fragment, null,
      textField('note', '笔记'), textField('remark', '备注'),
      select('显示设置', form.hidden, [...(once ? [['inherit', '沿用整条日程']] : []), ['show', '显示'], ['hide', '隐藏']], value => change('hidden', value)),
      select('提醒设置', form.reminder.mode, [...(once ? [['inherit', '沿用整条日程']] : []), ['off', '关闭提醒'], ['relative', '提前提醒'], ['fixed', '固定时间']], mode => change('reminder', { ...form.reminder, mode })),
      form.reminder.mode === 'relative' ? React.createElement(Field, { label: '提前分钟数' }, React.createElement(Input, {
        'aria-label': '提前分钟数', type: 'number', min: 0, max: 525600, value: form.reminder.minutes,
        onChange: (event: any) => change('reminder', { ...form.reminder, minutes: event.target.value }),
      })) : undefined,
      form.reminder.mode === 'fixed' ? React.createElement(Field, { label: '固定提醒时间' }, React.createElement(Input, {
        'aria-label': '固定提醒时间', type: 'datetime-local', value: form.reminder.at,
        onChange: (event: any) => change('reminder', { ...form.reminder, at: event.target.value }),
      })) : undefined,
      effective.legacyDescription !== undefined ? React.createElement('div', { style: { margin: '12px 0', whiteSpace: 'pre-wrap' } },
        React.createElement('strong', null, '旧备注备份（归属待确认）'), React.createElement('p', null, effective.legacyDescription),
        React.createElement(Button, { variant: 'outline', size: 'sm', onClick: () => change('remark', { mode: 'custom', text: effective.legacyDescription }) }, '复制到我的备注')) : undefined,
      effective.legacyExtensions ? React.createElement('details', null, React.createElement('summary', null, '旧附加信息备份（归属待确认）'), React.createElement('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, JSON.stringify(effective.legacyExtensions, null, 2))) : undefined,
      problem ? React.createElement('p', { role: 'alert' }, problem) : undefined,
      React.createElement(Button, { size: 'sm', variant: 'primary', disabled: busy || JSON.stringify(form) === JSON.stringify(baseline), onClick: save }, '保存个人设置')))
}
