// Agent tools over the subscription service.
//
// These tools let a session manage remote calendar feeds: subscribe, adjust,
// refresh and unsubscribe. They call the same `calendarSubscriptions` service
// the panel will, so there is one source of truth and one set of failure
// semantics — a failed refresh keeps the previous events and surfaces as a
// reported status, never as a silent empty calendar. Who may change
// subscriptions is decided here, in one place, the way the calendar's own
// tools do it in `lib/tool-permission.js`.
import { defineTool } from '@deepseek-ai/dsh-tools'

const WRITE_TOOLS = new Set([
  'calendar_subscribe',
  'calendar_update_subscription',
  'calendar_unsubscribe',
  'calendar_refresh_subscriptions',
])

const WRITE_REASON = '允许智能体管理日历订阅（添加、退订、调整或刷新远程日历源）'

/**
 * Decide one subscription tool call: every change asks first unless the
 * session already runs with approvals disabled.
 */
function decideSubscriptionPermission(ctx, exec, next) {
  if (!WRITE_TOOLS.has(exec.name)) return next()
  if (!exec.agent) return Promise.resolve({ kind: 'deny', reason: '日历订阅变更需要关联智能体会话' })
  if (ctx.permissionPresets.current(exec.agent.session) === 'danger-full-access') return next()
  return Promise.resolve({ kind: 'ask', reason: WRITE_REASON, displayReason: {
    zh: WRITE_REASON,
    en: 'Allow the Agent to manage calendar subscriptions (add, remove, adjust or refresh remote calendar feeds)',
  } })
}

const feedView = feed => ({
  id: feed.id,
  label: feed.label,
  url: feed.url,
  format: feed.format ?? 'ics',
  intervalHours: feed.intervalHours,
  enabled: feed.enabled,
  ...(feed.warnings ? { warnings: feed.warnings } : {}),
  ...(feed.state ? { state: feed.state } : {}),
  ...(feed.lastSuccessAt ? { lastSuccessAt: feed.lastSuccessAt } : {}),
  ...(feed.lastError ? { lastError: feed.lastError } : {}),
})

const feedLine = feed =>
  `${feed.id} 「${feed.label}」${feed.enabled ? '' : '（已停用）'} · 每 ${feed.intervalHours} 小时刷新 · 上次成功 ${feed.lastSuccessAt ?? '从未成功'}${feed.lastError ? ` · 最近错误：${feed.lastError}` : ''}${feed.warnings?.length ? ` · 格式提示：${feed.warnings.join('；')}` : ''}`

const feedSchemaTool = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    url: { type: 'string', required: true },
    format: { type: 'string', required: true },
    intervalHours: { type: 'number', required: true },
    enabled: { type: 'boolean', required: true },
    warnings: { type: 'array', items: { type: 'string' } },
    state: { type: 'string' },
    lastSuccessAt: { type: 'string' },
    lastError: { type: 'string' },
  },
}

export const name = 'dsh-calendar-subscriptions-tools'
export const inject = ['tools', 'calendarSubscriptions', 'permissionPresets']

export function apply(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => decideSubscriptionPermission(ctx, exec, next))

  ctx.tools.register(defineTool({
    name: 'calendar_subscriptions',
    description: "List this machine's calendar subscriptions: remote ICS feeds that refresh into the local calendar on a schedule. Reports each feed's label, refresh interval, enable state, last success time and last error.",
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { feeds: { type: 'array', required: true, items: feedSchemaTool } } },
      render: (_args, value) => [{ type: 'text', text: value.feeds.length ? value.feeds.map(feedLine).join('\n') : '当前没有任何日历订阅。' }],
    },
    execute() {
      return { feeds: ctx.calendarSubscriptions.feeds().map(feedView) }
    },
    presentCall: () => ({ card: 'generic', title: '日历 · 订阅列表', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_subscribe',
    description: 'Subscribe to a remote calendar and fetch it once. ICS is built in; academic-calendar and academic-timetable are available when the education plugin is enabled. Existing feeds are updated without duplicates.',
    parameters: {
      url: { type: 'string', required: true, description: 'The feed address, `http(s)`.' },
      label: { type: 'string', description: 'Name shown in the calendar. Defaults to the feed host.' },
      intervalHours: { type: 'number', description: 'Refresh interval in hours, minimum 1. Defaults to 24.' },
      profileID: { type: 'string', description: 'Optional OIDC profile for a host-approved service URL. Credentials are never stored in subscriptions.' },
      format: { type: 'string', description: 'Registered format: ics (default), academic-calendar, or academic-timetable.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          feed: feedSchemaTool,
          applied: { type: 'number' },
          removed: { type: 'number' },
          skipped: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { uid: { type: 'string' }, reason: { type: 'string' } } } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.error
          ? `已保存订阅「${value.feed.label}」，但首次拉取失败：${value.error}。旧数据（如有）保留，稍后会自动重试。`
          : `已订阅「${value.feed.label}」，本次写入 ${value.applied ?? 0} 条、移除 ${value.removed ?? 0} 条${value.skipped?.length ? `，${value.skipped.length} 条无法完整读取已跳过` : ''}。`,
      }],
    },
    async execute(args) {
      const { feed, refresh } = await ctx.calendarSubscriptions.addFeed(args)
      return {
        feed: feedView(feed),
        ...(refresh.error !== undefined ? { error: refresh.error }
          : { applied: refresh.applied ?? 0, ...(refresh.removed !== undefined ? { removed: refresh.removed } : {}), ...(refresh.skipped?.length ? { skipped: refresh.skipped } : {}) }),
      }
    },
    presentCall: args => ({ card: 'generic', title: '日历 · 添加订阅', kind: 'write', rawInput: args.url ?? '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_update_subscription',
    description: "Adjust one subscription: rename it, change its refresh interval, or pause and resume it. A paused feed stops refreshing and its events are hidden until resumed; nothing is deleted.",
    parameters: {
      id: { type: 'string', required: true, description: 'Subscription id from `calendar_subscriptions`.' },
      label: { type: 'string' },
      intervalHours: { type: 'number', description: 'Refresh interval in hours, minimum 1.' },
      enabled: { type: 'boolean', description: '`false` pauses the feed, `true` resumes it.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { feed: { ...feedSchemaTool, required: true } } },
      render: (_args, value) => [{ type: 'text', text: `订阅「${value.feed.label}」已更新${value.feed.enabled ? '' : '（已停用，事件隐藏）'}。` }],
    },
    async execute(args) {
      const patch = {}
      for (const key of ['label', 'intervalHours', 'enabled']) if (args[key] !== undefined) patch[key] = args[key]
      return { feed: feedView(await ctx.calendarSubscriptions.updateFeed(args.id, patch)) }
    },
    presentCall: args => ({ card: 'generic', title: '日历 · 调整订阅', kind: 'write', rawInput: args.id ?? '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_unsubscribe',
    description: 'Remove one subscription and clear the events it brought. Personal events, notes and reminders are untouched. Subscribing the same URL again restores the feed under the same id.',
    parameters: {
      id: { type: 'string', required: true, description: 'Subscription id from `calendar_subscriptions`.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { removed: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `已退订 ${value.removed}，其事件已从日历清除。` }],
    },
    async execute(args) {
      return await ctx.calendarSubscriptions.removeFeed(args.id)
    },
    presentCall: args => ({ card: 'generic', title: '日历 · 退订', kind: 'write', rawInput: args.id ?? '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_refresh_subscriptions',
    description: 'Fetch subscribed feeds now instead of waiting for their schedule: one feed by id, or every enabled feed when no id is given. A feed that fails keeps its previous events and reports its error.',
    parameters: {
      id: { type: 'string', description: 'Refresh only this subscription; omit to refresh all enabled feeds.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          results: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { id: { type: 'string', required: true }, applied: { type: 'number' }, error: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.results.map(result => result.error ? `${result.id} 刷新失败：${result.error}` : `${result.id} 已刷新（写入 ${result.applied ?? 0} 条）`).join('\n'),
      }],
    },
    async execute(args) {
      if (args.id !== undefined) {
        try {
          const report = await ctx.calendarSubscriptions.refresh(args.id)
          return { results: [{ id: args.id, applied: report.applied ?? 0 }] }
        } catch (error) {
          return { results: [{ id: args.id, error: String(error?.message ?? error) }] }
        }
      }
      const outcomes = await ctx.calendarSubscriptions.refreshAll()
      return { results: Object.entries(outcomes).map(([id, outcome]) => outcome.error !== undefined
        ? { id, error: outcome.error }
        : { id, applied: outcome.applied ?? 0 }) }
    },
    presentCall: args => ({ card: 'generic', title: '日历 · 刷新订阅', kind: 'write', rawInput: args.id ?? '全部' }),
  }))
}
