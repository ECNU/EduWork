import z from '@deepseek-ai/schemastery'
import { requestDecision, resolveDecisionConfig } from '@eduwork/dsh-decision/core'
import { resolve } from 'node:path'
import { reviewRequest, scriptOf, sessionFacts, SHELLS, verdict } from './review.js'

export const name = 'auto-approval'
export const inject = ['approval', 'permissionPresets', 'sandboxPolicy', 'workingDirectory']
export const Config = z.object({
  enabled: z.boolean().default(false).description('启用自动审批 / Enable automatic approval'),
  preset: z.string().default('auto-approval').description('在哪个权限预设下自动审批；预设须在 permission 插件里配置为 workspace-write + ask / Permission preset that turns review on; configure it as workspace-write + ask'),
  baseURL: z.string().default('').description('决策服务 API 基地址，包含 /v1 等前缀 / Decision API base URL including its prefix'),
  model: z.string().default('').description('决策模型名 / Decision model ID'),
  authMode: z.union(['api-key', 'oidc', 'none']).default('api-key').description('API Key、机构登录或明确免鉴权 / API key, organization sign-in or explicit unauthenticated mode'),
  credentialRef: z.string().default('SYSTEMONE_API_KEY').description('凭据引用名，不是 Key 本身 / Credential reference, not the key itself'),
  oidcProfileId: z.string().default('').description('OIDC 模式的机构账号 ID / Organization profile ID in OIDC mode'),
  timeoutMs: z.number().step(1).min(1000).max(30000).default(5000).description('一次审查的总时限，超时交给用户确认 / Time limit for one review; on expiry the user decides'),
})

const PAUSE_AFTER = 3, PAUSE_MS = 5 * 60_000
// Longer than any command the review was evaluated on (the longest was 13010 characters); such a command is the user's
// to read, which also bounds the time the rules take.
const COMMAND_CHARS = 16000
const SYSTEMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function apply(ctx, raw = {}) {
  if (!(raw.enabled ?? false)) return
  const timeoutMs = raw.timeoutMs ?? 5000
  // The review state carries recent messages and up to 16000 characters of script, so the request limit is higher
  // than the decision tool's default.
  const service = resolveDecisionConfig({
    enabled: true, baseURL: raw.baseURL, model: raw.model, authMode: raw.authMode, credentialRef: raw.credentialRef,
    oidcProfileId: raw.oidcProfileId, requestTimeoutMs: timeoutMs, maxRequestBytes: 256 * 1024,
  })
  const preset = raw.preset ?? 'auto-approval'
  const log = ctx.logger('auto-approval')
  // Shell calls in flight, by session and call ID. Escalation requests carry only the call ID, so the command comes
  // from the call, and a request is reviewed only while one call with that ID is in flight.
  const inFlight = new WeakMap()
  // Files the session's file tools created, from their results: a write that made a new file, a patch that added one.
  const created = new WeakMap()
  const failures = new Map()

  ctx.on('tools/pre-execute', async (exec, next) => {
    const session = exec.agent?.session
    // A subagent's messages come from the delegating agent, not the user, so its calls are never reviewed.
    if (!SHELLS.has(exec.name) || !session || session.header.origin === 'subagent') return next()
    const calls = inFlight.get(session) ?? new Map()
    inFlight.set(session, calls)
    // Two calls in flight under one ID cannot be told apart: neither is reviewed until both have finished.
    const entry = calls.get(exec.callId) ?? { tokens: new Set(), ambiguous: false }
    entry.ambiguous ||= entry.tokens.size > 0
    entry.tokens.add(exec.token)
    calls.set(exec.callId, entry)
    const decision = await next()
    // A call the other policies ask the user about is the user's to answer.
    if (decision.kind === 'allow' && exec.arguments.sandbox_permissions) entry.call = { name: exec.name, arguments: exec.arguments }
    return decision
  }, { prepend: true })

  ctx.on('tools/result', (exec, result) => {
    const session = exec.agent?.session
    if (!session) return
    const entry = inFlight.get(session)?.get(exec.callId)
    if (entry?.tokens.delete(exec.token) && !entry.tokens.size) inFlight.get(session).delete(exec.callId)
    if (result.isError) return
    const paths = exec.name === 'write' ? (result.value.operation === 'create' ? [result.value.path] : [])
      : exec.name === 'apply_patch' ? result.value.operations.filter(op => op.status === 'completed' && op.kind === 'add')
        .flatMap(op => op.changes.filter(change => change.before === null).map(change => change.path))
      : []
    if (paths.length) created.set(session, [...created.get(session) ?? [], ...paths].slice(-8))
  })

  async function fetchWith() {
    let fetchImpl
    if (service.authMode === 'oidc') {
      const account = ctx.get('oidcAccounts')
      if (!await account?.modelAuthorization?.(service.oidcProfileId, service.baseURL)) throw new Error('Not signed in to the decision service organization')
      fetchImpl = (url, init) => account.authorizedFetch(service.oidcProfileId, url, init)
    } else if (service.authMode === 'api-key') {
      const credential = await ctx.get('credentials')?.resolve(service.credentialRef)
      if (!credential?.value?.trim()) throw new Error('No decision service API key')
      fetchImpl = (url, init) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${credential.value}` }, redirect: 'error' })
    } else fetchImpl = (url, init) => fetch(url, { ...init, redirect: 'error' })
    // Asking the model has no side effects, so a network error, 429 or 5xx is tried once more within the time limit.
    return async (url, init) => {
      try {
        const response = await fetchImpl(url, init)
        if (response.status !== 429 && response.status < 500) return response
        await response.body?.cancel()
      } catch (error) {
        if (init.signal?.aborted) throw error
      }
      return fetchImpl(url, init)
    }
  }

  async function review(req, call, signal) {
    const { session } = req.agent
    // The sandbox's boundary stays where the session started; the shell runs in the current directory, which `/cd`
    // can move anywhere.
    const workspace = ctx.sandboxPolicy.resolve({ session }).workspaceRoot
    const base = ctx.workingDirectory.get(session)
    const cwd = call.arguments.workdir ? resolve(base, call.arguments.workdir) : base
    const command = call.arguments.command
    const { state, questions, flagged } = reviewRequest({
      system: `${SYSTEMS[process.platform] ?? process.platform}，shell 为 ${call.name === 'pwsh' ? 'PowerShell' : 'bash'}`,
      workspace, cwd, facts: { ...sessionFacts(session.snapshotEvents(), req.callId), created: created.get(session) ?? [] },
      justification: call.arguments.justification,
      command, script: await scriptOf(command, cwd),
    })
    const fetchImpl = await fetchWith()
    const results = await Promise.all(questions.map(question => requestDecision({ config: service, args: { state, questions: question }, fetchImpl, signal })))
    return { flagged, ...verdict(flagged, results) }
  }

  // Ahead of the client's answerer: approve what the review allows, hand everything else to the user unchanged.
  ctx.on('approval/request', async (req, next) => {
    const entry = inFlight.get(req.agent?.session)?.get(req.callId)
    const call = entry?.ambiguous ? undefined : entry?.call
    if (!call || call.name !== req.toolName || ctx.permissionPresets.current(req.agent.session) !== preset) return next()
    if (call.arguments.command.length > COMMAND_CHARS) return next()
    const id = req.agent.session.id
    if (failures.get(id)?.until > Date.now()) return next()
    const started = performance.now()
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(req.signal ? [req.signal] : [])])
    try {
      // The race also ends a review that waits on a stalled Host service (credentials, sign-in, files).
      const result = await Promise.race([review(req, call, signal), aborted(signal)])
      failures.delete(id)
      // Another call with this ID may have started during the review.
      const approved = result.approved && !entry.ambiguous
      log.info(`${call.name} ${approved ? 'approved' : 'asked the user'} (${result.flagged ? 'rule hit' : 'score'} ${result.score.toFixed(3)}, ${Math.round(performance.now() - started)} ms)`)
      if (approved) return 'allowed-once'
    } catch (error) {
      if (req.signal?.aborted) return next()
      const count = (failures.get(id)?.count ?? 0) + 1
      failures.set(id, count >= PAUSE_AFTER ? { count: 0, until: Date.now() + PAUSE_MS } : { count })
      log.warn(`review failed, asking the user (${Math.round(performance.now() - started)} ms): ${error?.message ?? error}`)
    }
    return next()
  }, { prepend: true })
}

const aborted = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason)
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
})
