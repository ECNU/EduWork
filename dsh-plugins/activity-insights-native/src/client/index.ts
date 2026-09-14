import React, { useEffect, useRef, useState } from 'react'
import activityRemote from './remote.js'

export const inject = ['slots', 'locale', 'remote']
const h = React.createElement
const NS = 'settings.activityInsights'
const zh = {
  nav: '个人概览', title: '个人概览', local: '本机使用概览', connected: '已连接', refresh: '刷新', refreshing: '正在统计…',
  loading: '正在读取本机使用记录…', unavailable: '暂时无法生成使用概览。', retry: '重试',
  phaseListing: '正在检查历史会话…', phaseScanning: '正在更新本机统计索引', phaseSaving: '正在保存统计结果',
  progressCount: '{completed}/{total} 个会话', progressDetail: '复用 {reused} 个 · 更新 {updated} 个',
  recordedTokens: '累计 Token 数', peakTokens: '峰值 Token 数', longestChat: '最长聊天时长', currentStreak: '当前连续天数', longestStreak: '最长连续天数',
  tokenActivity: '活动记录', activity: '活跃度', tokens: 'Token', chats: '总会话', activeDays: '活跃天数', userMessages: '用户消息', toolCalls: '工具调用', overview: '使用概览',
  uniqueSkills: '使用过的 Skills', skillRuns: 'Skills 调用', topModel: '最常用模型', topReasoning: '最常用推理档位', coverage: 'Token 记录覆盖率',
  tools: '常用工具', skills: '常用 Skills', none: '暂无记录', times: '{count} 次', days: '{count} 天', minutes: '{count} 分', hours: '{count} 小时', hoursMinutes: '{hours} 小时 {minutes} 分', less: '少', more: '多',
  privacy: '统计在本机即时生成，只读取 DSH 会话事件的时间、类型和用量元数据；不会上传或展示对话正文、工具参数、文件路径及结果内容。',
  coverageHint: '仅汇总模型服务实际返回的 usage。覆盖率不足 100% 时，“累计 Token 数”不代表全部历史用量。',
  durationHint: '按 DSH 会话统计中的模型运行时间与工具运行时间汇总，不包含关闭或闲置等待。',
  skipped: '有 {count} 个历史会话暂时无法读取，已跳过。',
}
const en = {
  nav: 'Activity', title: 'Personal activity', local: 'Local activity', connected: 'Connected', refresh: 'Refresh', refreshing: 'Calculating…',
  loading: 'Reading local activity…', unavailable: 'Activity insights are temporarily unavailable.', retry: 'Retry',
  phaseListing: 'Checking session history…', phaseScanning: 'Updating the local activity index', phaseSaving: 'Saving activity summaries',
  progressCount: '{completed}/{total} sessions', progressDetail: '{reused} reused · {updated} updated',
  recordedTokens: 'Lifetime tokens', peakTokens: 'Peak tokens', longestChat: 'Longest chat duration', currentStreak: 'Current streak', longestStreak: 'Longest streak',
  tokenActivity: 'Activity history', activity: 'Activity', tokens: 'Tokens', chats: 'Chats', activeDays: 'Active days', userMessages: 'User messages', toolCalls: 'Tool calls', overview: 'Usage overview',
  uniqueSkills: 'Skills explored', skillRuns: 'Skill runs', topModel: 'Most used model', topReasoning: 'Most used reasoning', coverage: 'Token coverage',
  tools: 'Most used tools', skills: 'Most used Skills', none: 'No activity yet', times: '{count} runs', days: '{count} days', minutes: '{count} min', hours: '{count} hr', hoursMinutes: '{hours} hr {minutes} min', less: 'Less', more: 'More',
  privacy: 'Generated locally from DSH event timestamps, types, and usage metadata. Conversation text, tool arguments, file paths, and results are never uploaded or displayed.',
  coverageHint: 'Only provider-reported usage is counted. If coverage is below 100%, recorded tokens do not represent all historical usage.',
  durationHint: 'Sum of model and tool runtime from DSH session statistics; closed and idle time is excluded.',
  skipped: '{count} historical sessions could not be read and were skipped.',
}

const primary = 'var(--dsw-alias-label-primary, #221b18)'
const secondary = 'var(--dsw-alias-label-secondary, #746762)'
const tertiary = 'var(--dsw-alias-label-tertiary, #9a8f89)'
const border = 'var(--dsw-alias-border-l2, #e7dfda)'
const layer = 'var(--dsw-alias-bg-layer-1, #fffdfb)'
const accent = 'var(--chatecnu-logo-accent, var(--dsw-alias-state-business-primary, #9f2636))'

async function withTimeout(operation, timeoutMs = 45_000) {
  let timeout
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('activity insights request timed out')), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function unwrap(operation) {
  const result = await operation
  if (result?.ok === true) return result.value
  throw new Error(result?.error?.message || result?.error?.code || 'activity insights unavailable')
}

function compact(value) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)
}

function duration(ms, t) {
  const minutes = Math.round((ms || 0) / 60_000)
  if (minutes < 60) return format(t('minutes'), { count: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest
    ? format(t('hoursMinutes'), { hours, minutes: rest })
    : format(t('hours'), { count: hours })
}

function format(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''))
}

function initials(name) {
  const text = String(name || '').trim()
  if (!text) return 'ME'
  if (/^[\x00-\x7F]+$/.test(text)) return text.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return [...text].slice(-2).join('')
}

function Metric({ label, value, hint, divided = false }) {
  return h('div', { style: { minWidth: 0, padding: '3px 8px', textAlign: 'center', borderLeft: divided ? `1px solid ${border}` : 0 } },
    h('strong', { style: { display: 'block', color: primary, fontSize: 18, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-.02em', whiteSpace: 'nowrap' } }, value),
    h('span', { title: hint, style: { display: 'block', marginTop: 6, color: secondary, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
  )
}

function ScanProgress({ progress, t }) {
  const total = Math.max(0, progress?.total ?? 0)
  const completed = Math.min(total, Math.max(0, progress?.completed ?? 0))
  const percent = total > 0 ? Math.round(completed / total * 100) : 0
  const phaseLabel = progress?.phase === 'saving'
    ? t('phaseSaving')
    : progress?.phase === 'scanning' ? t('phaseScanning') : t('phaseListing')
  return h('div', { role: 'status', 'aria-live': 'polite', style: { width: '100%', maxWidth: 560, marginTop: 14 } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 7, color: secondary, fontSize: 12 } },
      h('span', null, phaseLabel),
      total > 0 && h('span', null, format(t('progressCount'), { completed, total })),
    ),
    h('div', { style: { height: 6, overflow: 'hidden', borderRadius: 999, background: 'var(--dsw-alias-fill-secondary, #ece8e5)' } },
      h('div', { style: {
        width: total > 0 ? `${percent}%` : '8%', minWidth: progress?.state === 'running' ? 8 : 0, height: '100%',
        borderRadius: 999, background: accent, transition: 'width 180ms ease-out',
      } }),
    ),
    total > 0 && h('div', { style: { marginTop: 7, color: tertiary, fontSize: 11 } },
      format(t('progressDetail'), { reused: progress?.reusedSessions ?? 0, updated: progress?.updatedSessions ?? 0 }),
    ),
  )
}

function Heatmap({ activity, metric, setMetric, t }) {
  const values = activity.map(day => metric === 'tokens' ? day.tokens : day.turns + day.toolCalls)
  const nonzero = values.filter(Boolean).sort((a, b) => a - b)
  const ceiling = nonzero.length ? nonzero[Math.min(nonzero.length - 1, Math.floor(nonzero.length * .9))] : 1
  const first = activity[0]?.date
  const leading = first ? (new Date(`${first}T12:00:00`).getDay() + 6) % 7 : 0
  const columns = Math.max(1, Math.ceil((leading + activity.length) / 7))
  const cells = Array.from({ length: leading }, (_, index) => h('span', { key: `blank-${index}`, 'aria-hidden': true }))
  const backgrounds = [
    'var(--dsw-alias-fill-secondary, #eceff2)',
    `color-mix(in srgb, ${accent} 22%, var(--dsw-alias-bg-base, #fff))`,
    `color-mix(in srgb, ${accent} 42%, var(--dsw-alias-bg-base, #fff))`,
    `color-mix(in srgb, ${accent} 66%, var(--dsw-alias-bg-base, #fff))`, accent,
  ]
  const monthLabels = []
  let priorMonth = ''
  let priorColumn = -9
  for (let index = 0; index < activity.length; index += 1) {
    const day = activity[index]
    const value = values[index]
    const level = value === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(value / Math.max(1, ceiling) * 4)))
    const month = day.date.slice(0, 7)
    if (month !== priorMonth) {
      const column = Math.floor((leading + index) / 7)
      if (column - priorColumn >= 4) {
        monthLabels.push({ column, label: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(`${day.date}T12:00:00`)) })
        priorColumn = column
      }
      priorMonth = month
    }
    cells.push(h('span', {
      key: day.date,
      title: `${day.date} · ${day.turns} ${t('userMessages')} · ${day.toolCalls} ${t('toolCalls')} · ${compact(day.tokens)} Token`,
      style: { width: '100%', minWidth: 0, aspectRatio: '1', borderRadius: 2, background: backgrounds[level] },
    }))
  }
  return h('section', { style: { marginTop: 34, padding: '28px 0 26px', borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}` } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 22 } },
      h('h3', { style: { margin: 0, color: primary, fontSize: 14 } }, t('tokenActivity')),
      h('div', { style: { display: 'flex', gap: 4 } },
        ...['activity', 'tokens'].map(value => h('button', {
          key: value, type: 'button', onClick: () => setMetric(value),
          style: { border: 0, borderRadius: 7, padding: '5px 9px', background: metric === value ? 'var(--dsw-alias-fill-secondary, #edf0f2)' : 'transparent', color: metric === value ? primary : tertiary, cursor: 'pointer', fontSize: 11 },
        }, t(value))),
      ),
    ),
    h('div', { style: { position: 'relative', height: 18, marginBottom: 7, color: tertiary, fontSize: 10 } },
      ...monthLabels.map(item => h('span', { key: `${item.column}-${item.label}`, style: { position: 'absolute', left: `${Math.min(96, item.column / columns * 100)}%`, whiteSpace: 'nowrap' } }, item.label)),
    ),
    h('div', {
      role: 'img', 'aria-label': t('tokenActivity'),
      style: {
        width: '100%', display: 'grid', gridTemplateRows: 'repeat(7, minmax(0, 1fr))',
        gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)', gap: 3,
        aspectRatio: `${columns} / 7`, overflow: 'hidden',
      },
    }, ...cells),
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 12, color: tertiary, fontSize: 10 } },
      h('span', null, t('less')),
      ...backgrounds.map((background, index) => h('span', { key: index, style: { width: 9, height: 9, borderRadius: 2, background } })),
      h('span', null, t('more')),
    ),
  )
}

export function ActivityInsights({ service, t }) {
  const [state, setState] = useState({ status: 'loading' })
  const [metric, setMetric] = useState('activity')
  const [progress, setProgress] = useState(null)
  const mounted = useRef(true)
  const request = useRef(0)
  const load = async (refresh = false) => {
    const currentRequest = ++request.current
    setState(current => ({ ...current, status: current.value ? 'refreshing' : 'loading' }))
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const next = await service.progress()
        if (mounted.current && request.current === currentRequest) setProgress(next)
      } catch {} finally { polling = false }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 200)
    try {
      const value = await withTimeout(service.snapshot(refresh))
      if (mounted.current && request.current === currentRequest) {
        setState({ status: 'ready', value })
        setProgress(null)
      }
    } catch (error) {
      if (mounted.current && request.current === currentRequest) {
        setState({ status: 'error', error: String(error?.message ?? error) })
      }
    } finally { clearInterval(timer) }
  }
  useEffect(() => {
    mounted.current = true
    void load(false)
    return () => { mounted.current = false; request.current += 1 }
  }, [])
  if (state.status === 'loading') return h('div', { style: { width: '100%', maxWidth: 700, paddingTop: 6 } },
    h('p', { style: { margin: 0, color: secondary } }, t('loading')),
    h(ScanProgress, { progress, t }),
  )
  if (state.status === 'error') return h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary, #b52d3b)' } },
    h('p', null, t('unavailable'), ' ', state.error),
    h('button', { type: 'button', onClick: () => load(false) }, t('retry')),
  )
  const value = state.value
  const name = value.profile.displayName || t('local')
  const model = value.topModels[0]?.name || t('none')
  const reasoning = value.reasoningEfforts[0]?.name || t('none')
  const detailRows = [
    [t('chats'), compact(value.totals.chats)], [t('activeDays'), format(t('days'), { count: value.totals.activeDays })],
    [t('userMessages'), compact(value.totals.userMessages)], [t('toolCalls'), compact(value.totals.toolCalls)],
    [t('uniqueSkills'), compact(value.totals.uniqueSkills)], [t('skillRuns'), compact(value.totals.skillInvocations)],
    [t('topModel'), model], [t('topReasoning'), reasoning], [t('coverage'), `${value.tokens.coveragePercent}%`],
  ]

  return h('div', { style: { width: '100%', maxWidth: 920, color: primary } },
    h('header', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18 } },
      h('div', null, h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25 } }, t('title')),
        h('p', { style: { margin: '8px 0 0', maxWidth: 720, color: secondary, fontSize: 12, lineHeight: 1.6 } }, t('privacy'))),
      h('button', { type: 'button', disabled: state.status === 'refreshing', onClick: () => load(true), style: { flex: 'none', border: `1px solid ${border}`, borderRadius: 8, padding: '7px 11px', background: layer, color: primary, cursor: 'pointer', fontSize: 12 } }, state.status === 'refreshing' ? t('refreshing') : t('refresh')),
    ),
    state.status === 'refreshing' && h(ScanProgress, { progress, t }),
    h('section', { style: { padding: '30px 0 24px', textAlign: 'center' } },
      h('div', { title: name, 'aria-label': name, style: { width: 64, height: 64, display: 'grid', placeItems: 'center', margin: '0 auto', borderRadius: '50%', background: 'color-mix(in srgb, var(--dsw-alias-label-primary, #222) 92%, transparent)', color: 'var(--dsw-alias-bg-base, #fff)', fontSize: 21 } }, initials(name)),
    ),
    h('section', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', overflow: 'hidden', border: `1px solid ${border}`, borderRadius: 14, padding: '14px 0', background: layer } },
      h(Metric, { label: t('recordedTokens'), value: compact(value.tokens.recorded), hint: t('coverageHint') }),
      h(Metric, { label: t('peakTokens'), value: compact(value.tokens.peak), hint: t('coverageHint'), divided: true }),
      h(Metric, { label: t('longestChat'), value: duration(value.longestChatMs, t), hint: t('durationHint'), divided: true }),
      h(Metric, { label: t('currentStreak'), value: format(t('days'), { count: value.streaks.currentDays }), divided: true }),
      h(Metric, { label: t('longestStreak'), value: format(t('days'), { count: value.streaks.longestDays }), divided: true }),
    ),
    h(Heatmap, { activity: value.activity, metric, setMetric, t }),
    h('section', { style: { padding: '30px 0 4px' } },
      h('h3', { style: { margin: '0 0 14px', fontSize: 14, fontWeight: 650 } }, t('overview')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 44px' } },
        ...detailRows.map(([label, content]) => h('div', { key: label, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, minWidth: 0, padding: '10px 0', borderBottom: `1px solid ${border}`, fontSize: 12 } },
          h('span', { style: { color: secondary } }, label),
          h('span', { title: content, style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', color: primary } }, content),
        )),
      ),
    ),
    h('p', { style: { margin: '28px 0 0', color: tertiary, fontSize: 11, lineHeight: 1.55 } }, t('coverageHint')),
    value.skippedSessions > 0 && h('p', { role: 'status', style: { margin: '6px 0 0', color: tertiary, fontSize: 11 } }, format(t('skipped'), { count: value.skippedSessions })),
  )
}

export async function apply(ctx) {
  const disposeRemote = await ctx.remote.$mount(activityRemote)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'activity-insights: dictionaries')
  ctx.inject(['remote.activityInsights'], surface => {
    const t = surface.locale.bind(NS)
    const service = {
      snapshot: refresh => unwrap(surface.remote.activityInsights.snapshot(JSON.stringify({
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', refresh: refresh === true,
      }))),
      progress: () => unwrap(surface.remote.activityInsights.progress()),
    }
    surface.slots.inject('settings.section', () => surface.slots.register({
      name: 'settings.section', id: 'activity-insights', order: 12,
      label: () => t('nav'), locale: NS, inject: () => ({ service, t }),
    }, ActivityInsights))
  })
  return async () => { await disposeRemote() }
}
