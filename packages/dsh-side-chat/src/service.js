import { randomUUID } from 'node:crypto'
import { buildForkSeed, SessionId } from '@deepseek-ai/dsh-session'
import { SIDE_BOUNDARY, disallowedSideTool } from './boundary.js'

export const SIDE_CHAT_PATH = '/api/eduwork/side-chat'

export class SideChatError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

function validateOwner(owner) {
  if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{24,128}$/.test(owner)) throw new SideChatError('Invalid temporary-chat owner')
}

/** One owning handle per temporary chat. Ownership never expires with inactivity. */
export class SideChatService {
  constructor(ctx) {
    this.ctx = ctx
    this.entries = new Map()
    this.disposed = false
  }

  async open({ owner, sourceSessionId, atSeq }) {
    validateOwner(owner)
    if (this.disposed) throw new SideChatError('Side-chat service is closing', 503)
    if (typeof sourceSessionId !== 'string' || sourceSessionId.length === 0 || sourceSessionId.length > 256
      || !Number.isSafeInteger(atSeq) || atSeq < 0) throw new SideChatError('Choose an existing message boundary')
    const existing = this.entries.get(owner)
    if (existing) {
      if (existing.sourceSessionId !== sourceSessionId || existing.atSeq !== atSeq || existing.closing) {
        throw new SideChatError('Close the existing side chat first', 409)
      }
      await existing.creation
      return this.describe(existing)
    }
    const entry = {
      owner, sourceSessionId, atSeq, sessionId: SessionId(`side-${randomUUID()}`),
      controller: new AbortController(),
      closing: false, handle: undefined, creation: undefined, cleanup: undefined,
    }
    this.entries.set(owner, entry)
    entry.creation = this.create(entry)
    try {
      await entry.creation
      if (entry.closing) throw new SideChatError('Side chat was closed while opening', 409)
      return this.describe(entry)
    } catch (error) {
      await this.close({ owner }).catch(() => {})
      throw error
    }
  }

  async create(entry) {
    const observed = await this.ctx.sessionQuery.observeSession(SessionId(entry.sourceSessionId))
    try {
      if (observed.header.id.startsWith('side-')) throw new SideChatError('A temporary side chat cannot open another side chat')
      const boundary = observed.events[entry.atSeq]
      if (boundary?.seq !== entry.atSeq || !['user/message', 'assistant/message', 'turn/end'].includes(boundary.type)) {
        throw new SideChatError('The selected message is no longer available')
      }
      const seed = buildForkSeed(observed.events, boundary.seq)
      entry.seedLength = seed.length
      const model = seed.findLast(event => event.type === 'request/header')?.data.header.config
        ?? this.ctx.get('agentDefaultModel')?.currentSelection() ?? {}
      const presets = this.ctx.get('agentPresets')
      const presetId = presets ? (await presets.resolve(observed.header.agentPreset)).id : undefined
      entry.controller.signal.throwIfAborted()
      entry.handle = await this.ctx.agents.create({
        sessionId: entry.sessionId,
        seed,
        meta: {
          cwd: observed.header.cwd, parentSession: observed.header.id,
          seedLength: seed.length,
          ...(presetId ? { agentPreset: presetId } : {}),
        },
        agentOptions: { provider: model.provider, model: model.model, reasoningEffort: model.reasoningEffort },
        signal: entry.controller.signal,
        setup: async (agentCtx, _agent) => {
          if (presets) await presets.mount(agentCtx, presetId)
          agentCtx.systemPrompt.context({ name: 'eduwork-side-boundary', order: 999_000, text: SIDE_BOUNDARY, required: true, interpolate: false })
          agentCtx.on('tools/pre-execute', (exec, next) => disallowedSideTool(exec.name)
            ? Promise.resolve({ kind: 'deny', reason: 'Temporary side chats cannot own subagents or long-lived background work' })
            : next())
        },
      })
    } finally {
      observed[Symbol.dispose]()
    }
  }

  describe(entry) {
    return { sessionId: entry.sessionId, sourceSessionId: entry.sourceSessionId, atSeq: entry.atSeq, seedLength: entry.seedLength ?? 0 }
  }

  heartbeat({ owner, sessionId }) {
    // Compatibility status check for older clients; it never extends a timer.
    validateOwner(owner)
    const entry = this.entries.get(owner)
    if (!entry || entry.closing || entry.sessionId !== sessionId) throw new SideChatError('Temporary chat has ended', 410)
    return this.describe(entry)
  }

  async close({ owner, sessionId }) {
    validateOwner(owner)
    const entry = this.entries.get(owner)
    if (!entry) return { closed: true }
    if (sessionId !== undefined && entry.sessionId !== sessionId) throw new SideChatError('Temporary-chat owner does not match', 409)
    entry.closing = true
    entry.controller.abort(new Error('Temporary side chat closed'))
    entry.cleanup ??= (async () => {
      await entry.creation?.catch(() => {})
      await entry.handle?.dispose()
      if (this.entries.get(owner) === entry) this.entries.delete(owner)
      return { closed: true }
    })().catch(error => { entry.cleanup = undefined; throw error })
    return entry.cleanup
  }

  async retryCleanup() {
    await Promise.allSettled([...this.entries.values()]
      .filter(entry => entry.closing)
      .map(entry => this.close({ owner: entry.owner })))
  }

  async dispose() {
    this.disposed = true
    const results = await Promise.allSettled([...this.entries.keys()].map(owner => this.close({ owner })))
    const failed = results.filter(result => result.status === 'rejected')
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Failed to stop temporary chats')
  }

  async fetch(request) {
    try {
      const body = await request.text()
      if (body.length > 16_384) throw new SideChatError('Temporary-chat request is too large', 413)
      let input
      try { input = JSON.parse(body) } catch { throw new SideChatError('Invalid temporary-chat request') }
      if (!input || typeof input !== 'object') throw new SideChatError('Invalid temporary-chat request')
      let result
      switch (input.action) {
        case 'open': result = await this.open(input); break
        case 'heartbeat': result = this.heartbeat(input); break
        case 'close': result = await this.close(input); break
        default: throw new SideChatError('Unknown temporary-chat action')
      }
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      return Response.json({ error: error instanceof SideChatError ? error.message : 'Temporary chat failed' }, {
        status: error instanceof SideChatError ? error.status : 500, headers: { 'Cache-Control': 'no-store' },
      })
    }
  }
}
