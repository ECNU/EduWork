import { normalizeSources } from './core.js'

// V4 rejects the retired plugin wrapper. Use the same producer name that the
// official V3 migration assigns to our historical Memory notices.
export function memoryMessageSource(session, summary) {
  const producer = session?.header?.version >= 4
    ? { kind: 'plugin:memory-native' }
    : { kind: 'plugin', plugin: 'memory-native' }
  return { ...producer, form: 'notice', summary }
}

function sessionEvents(session) {
  if (session == null) return []
  const events = typeof session.snapshotEvents === 'function'
    ? session.snapshotEvents()
    : session.events
  if (!Array.isArray(events)) throw new Error('local Memory requires a readable Session event snapshot')
  return events
}

function latestDirectUserEvent(events) {
  return events.findLast(event => event.type === 'user/message' && event.data?.source?.kind === 'user')
}

export function explicitMemoryRequest(session) {
  const message = latestDirectUserEvent(sessionEvents(session))?.data
  const text = (Array.isArray(message?.content)
    ? message.content.filter(block => block?.type === 'text').map(block => block.text).join('\n')
    : '').toLowerCase()
  return /(?:记住|记一下|请记得|别忘|保存.{0,8}(?:memory|记忆)|存.{0,8}(?:memory|记忆)|remember|save (?:this|that|it) (?:to|in|as) memory)/iu.test(text)
}

export function executionSources(exec, supplied) {
  const session = exec.agent?.session
  const events = sessionEvents(session)
  const direct = latestDirectUserEvent(events)
  const sources = [...supplied]
  if (session != null) {
    sources.push({
      kind: 'session', sessionId: String(session.id),
      messageId: direct?.data?.id === undefined ? null : String(direct.data.id),
      eventSeq: Number.isSafeInteger(direct?.seq) ? direct.seq : null,
      label: 'direct user message',
    })
    const after = Number.isSafeInteger(direct?.seq) ? direct.seq : -1
    for (const event of events) {
      if (event.seq <= after || event.type !== 'tool/call') continue
      const toolName = typeof event.data?.name === 'string' ? event.data.name : ''
      if (toolName === '' || toolName.startsWith('memory_')) continue
      sources.push({
        kind: 'tool', sessionId: String(session.id), eventSeq: event.seq, toolName,
        callId: event.data?.callId === undefined ? null : String(event.data.callId),
      })
    }
  }
  return normalizeSources(sources)
}
