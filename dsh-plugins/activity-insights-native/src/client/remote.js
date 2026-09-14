import { z } from 'zod'

const ranked = z.object({ name: z.string(), count: z.number().int().nonnegative() }).strict()
const result = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, schema })
const snapshot = z.object({
  generatedAt: z.string(), timeZone: z.string(),
  profile: z.object({ displayName: z.string().nullable(), organization: z.string().nullable(), affiliation: z.string().nullable(), connected: z.boolean() }).strict(),
  totals: z.object({
    chats: z.number().int().nonnegative(), subagentSessions: z.number().int().nonnegative(), activeDays: z.number().int().nonnegative(),
    userMessages: z.number().int().nonnegative(), assistantMessages: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(),
    skillInvocations: z.number().int().nonnegative(), uniqueSkills: z.number().int().nonnegative(),
  }).strict(),
  tokens: z.object({ recorded: z.number().int().nonnegative(), peak: z.number().int().nonnegative(), callsWithUsage: z.number().int().nonnegative(), assistantCalls: z.number().int().nonnegative(), coveragePercent: z.number().int().min(0).max(100) }).strict(),
  streaks: z.object({ currentDays: z.number().int().nonnegative(), longestDays: z.number().int().nonnegative() }).strict(),
  longestChatMs: z.number().int().nonnegative(),
  activity: z.array(z.object({ date: z.string(), sessions: z.number().int().nonnegative(), turns: z.number().int().nonnegative(), assistantMessages: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() }).strict()).max(366),
  topTools: z.array(ranked).max(10), topSkills: z.array(ranked).max(10), topModels: z.array(ranked).max(10), reasoningEfforts: z.array(ranked).max(10),
  skippedSessions: z.number().int().nonnegative(),
}).strict()
const progress = z.object({
  state: z.enum(['idle', 'running', 'ready', 'error']),
  phase: z.enum(['listing', 'scanning', 'saving', 'ready']),
  completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(),
  reusedSessions: z.number().int().nonnegative(), updatedSessions: z.number().int().nonnegative(),
  skippedSessions: z.number().int().nonnegative(),
}).strict()
const pkg = '@chatecnu-work/dsh-activity-insights-native'
export default {
  package: pkg,
  descriptors: [{
    id: `${pkg}#activityInsights/snapshot`, service: 'activityInsights', namespace: 'activityInsights', method: 'snapshot',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: result(`${pkg}#ActivityRequest`, z.string().max(2048)) }],
    result: result(`${pkg}#ActivitySnapshot`, snapshot),
    sourceLocation: { file: 'dsh-plugins/activity-insights-native/lib/index.js', line: 1, column: 1 },
  }, {
    id: `${pkg}#activityInsights/progress`, service: 'activityInsights', namespace: 'activityInsights', method: 'progress',
    invocation: { kind: 'direct' }, parameters: [], result: result(`${pkg}#ActivityProgress`, progress),
    sourceLocation: { file: 'dsh-plugins/activity-insights-native/lib/index.js', line: 1, column: 1 },
  }],
}
