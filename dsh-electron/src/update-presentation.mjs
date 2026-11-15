// Read-only conversion from the product updater snapshot to the official
// Desktop update presentation. Content updates are intentionally not mapped.
const IDLE = new Set(['idle', 'up_to_date', 'current', 'installed', 'disabled'])
const FAILED_OPERATIONS = new Set(['check', 'download', 'install'])
const VERIFYING_STAGES = new Set(['verifying', 'extracting'])

function version(update) {
  const value = update.latestVersion
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 64 && !/[\u0000-\u001f\u007f]/u.test(trimmed) ? trimmed : undefined
}

function percent(update) {
  const downloaded = update.downloadedBytes, total = update.totalBytes
  if (!Number.isFinite(downloaded) || downloaded < 0 || !Number.isFinite(total) || total <= 0) return undefined
  return Math.min(100, Math.max(0, Math.floor(downloaded / total * 100)))
}

function withVersion(presentation, update) {
  const value = version(update)
  return value === undefined ? presentation : { ...presentation, version: value }
}

/**
 * @param status - One updateCoordinator snapshot, or null when no backend exists yet.
 * @returns Official presentation, or null when the snapshot cannot be classified.
 */
export function desktopUpdatePresentation(status) {
  if (status === null || status === undefined) return { phase: 'idle' }
  if (typeof status !== 'object' || Array.isArray(status)) return null
  const update = status.update
  if (update === null || typeof update !== 'object' || Array.isArray(update)) return null
  const state = update.state
  if (typeof state !== 'string') return null
  // A real failure must win over enabled=false, which also covers startup errors.
  // Without a proven operation there is no truthful official failure kind.
  if (state === 'error') {
    return FAILED_OPERATIONS.has(update.failedOperation) ? { phase: 'error', failure: update.failedOperation } : null
  }
  if (IDLE.has(state)) return { phase: 'idle' }
  if (state === 'checking') return { phase: 'checking' }
  if (state === 'available') return withVersion({ phase: 'available' }, update)
  if (state === 'downloading') {
    // Verification/extraction is preparation, not a finished package.
    if (VERIFYING_STAGES.has(update.downloadStage)) return withVersion({ phase: 'verifying' }, update)
    const progress = percent(update)
    return withVersion(progress === undefined ? { phase: 'downloading' } : { phase: 'downloading', percent: progress }, update)
  }
  if (state === 'verifying') return withVersion({ phase: 'verifying' }, update)
  if (state === 'ready') return withVersion({ phase: 'ready' }, update)
  if (state === 'applying') return withVersion({ phase: 'installing' }, update)
  return null
}
