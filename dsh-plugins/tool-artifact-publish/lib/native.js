// Product generators publish through the native, durable deliverable event.
// File cards, session replay, preview and native-open policy remain upstream.
import { normalizeArtifactRelativePath } from './core.js'

export const name = 'product-native-deliverables'
export const inject = ['tools', 'fs', 'sessionProjections']
const producers = new Set(['artifact_publish', 'image_generate', 'ecnu_image_generate', 'ecnu_tts_generate',
  'speech_synthesize', 'media_render', 'video_project', 'office_document', 'office_spreadsheet', 'office_presentation', 'office_pdf'])

function outputPath(exec, result) {
  if (result.isError || !producers.has(exec.name) || typeof result.value?.relativePath !== 'string') return undefined
  try { return normalizeArtifactRelativePath(result.value.relativePath) } catch { return undefined }
}

export function apply(ctx) {
  const prepared = new WeakMap(), children = new Map()
  ctx.effect(() => () => children.clear())
  // Validation must finish before the final synchronous result notification;
  // an asynchronous tools/result listener could append after the turn closes.
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const path = outputPath(exec, result), session = exec.agent?.session
    if (!path || !session?.header.cwd || exec.signal.aborted) return decision
    const boundary = ctx.sessionProjections.stateOf(session, 'turnBoundary')
    if (!boundary || boundary.openTurnStartSeq === null) return decision
    try {
      const fs = exec.agent.ctx.get('fs')
      if (!fs) return decision
      const options = { cwd: session.header.cwd, signal: exec.signal }
      const root = await fs.resolve('.', options), target = await fs.resolve(path, options)
      const entry = await fs.lstat(path, { cwd: session.header.cwd }, exec.signal)
      if (entry?.type !== 'file' || !fs.contains(root, target)) return decision
      const stat = await fs.stat(target, exec.signal)
      if (stat?.type !== 'file' || Number(stat.size) <= 0 || exec.signal.aborted) return decision
      prepared.set(exec, { session, turn: boundary.lastTurn, path })
    } catch {
      // File access can be revoked after generation. Preserve the tool outcome;
      // do not create an unusable or unauthorized delivery card.
    }
    return decision
  })
  ctx.on('tools/result', (exec, result) => {
    const own = prepared.get(exec), nested = children.get(exec.token) ?? []
    prepared.delete(exec); children.delete(exec.token)
    if (result.isError || exec.signal.aborted) return
    const session = exec.agent?.session
    if (!session) return
    const records = [...nested, ...own && own.path === outputPath(exec, result) ? [own] : []]
    const boundary = ctx.sessionProjections.stateOf(session, 'turnBoundary')
    if (!boundary || boundary.openTurnStartSeq === null) return
    const valid = records.filter(row => row.session === session && row.turn === boundary.lastTurn)
    if (!valid.length) return
    if (exec.parent !== undefined) {
      // PTC children commit only after the outer transport succeeds. A failed
      // or cancelled run_code discards all its pending generated deliveries.
      children.set(exec.parent, [...children.get(exec.parent) ?? [], ...valid].slice(0, 64))
      return
    }
    const paths = [...new Set(valid.map(row => row.path))]
    session.append('deliverables/presented', { turn: boundary.lastTurn, callId: exec.callId, files: paths.map(path => ({ path })) })
  })
}
