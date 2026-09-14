import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const CACHE_SCHEMA_VERSION = 3
const MAX_CACHE_BYTES = 64 * 1024 * 1024

function safeNamespace(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(normalized) ? normalized : 'default'
}

function validEntry(value) {
  return value && typeof value === 'object' &&
    typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 256 &&
    typeof value.revision === 'string' && value.revision.length > 0 && value.revision.length <= 1024 &&
    Number.isSafeInteger(value.cursor) && value.cursor >= -1 &&
    value.summary?.schemaVersion === 3 && value.summary.sessionId === value.sessionId
}

function record(timeZone, entries, scan) {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    timeZone,
    savedAt: new Date().toISOString(),
    scan: {
      total: Number.isSafeInteger(scan?.total) ? scan.total : entries.size,
      reusedSessions: Number.isSafeInteger(scan?.reusedSessions) ? scan.reusedSessions : 0,
      updatedSessions: Number.isSafeInteger(scan?.updatedSessions) ? scan.updatedSessions : 0,
      skippedSessions: Number.isSafeInteger(scan?.skippedSessions) ? scan.skippedSessions : 0,
      durationMs: Number.isSafeInteger(scan?.durationMs) ? scan.durationMs : 0,
    },
    sessions: [...entries.values()].map(entry => ({
      sessionId: entry.sessionId,
      revision: entry.revision,
      cursor: entry.cursor,
      summary: entry.summary,
    })),
  }
}

/** Best-effort local persistence for content-free per-session projections. */
export class ActivitySummaryStore {
  constructor(options = {}) {
    this.filename = join(
      resolveDshHome(options.dshHome),
      'derived',
      'activity-insights',
      'v3',
      `${safeNamespace(options.namespace)}.json`,
    )
    this.logger = options.logger
  }

  warn(message, error) {
    this.logger?.warn?.(`activity-insights-native: ${message}`, { error })
  }

  async load(timeZone) {
    try {
      const info = await stat(this.filename)
      if (!info.isFile() || info.size > MAX_CACHE_BYTES) {
        this.warn('ignored an oversized or non-file activity summary cache')
        return new Map()
      }
      const parsed = JSON.parse(await readFile(this.filename, 'utf8'))
      if (parsed?.schemaVersion !== CACHE_SCHEMA_VERSION || parsed?.timeZone !== timeZone || !Array.isArray(parsed?.sessions)) {
        return new Map()
      }
      const entries = new Map()
      for (const entry of parsed.sessions) {
        if (validEntry(entry)) entries.set(entry.sessionId, entry)
      }
      return entries
    } catch (error) {
      if (error?.code !== 'ENOENT') this.warn('could not read the activity summary cache', error)
      return new Map()
    }
  }

  async save(timeZone, entries, scan) {
    try {
      await writeFileAtomic(this.filename, `${JSON.stringify(record(timeZone, entries, scan))}\n`, {
        mode: 0o600,
        dirMode: 0o700,
      })
    } catch (error) {
      this.warn('could not persist the activity summary cache', error)
    }
  }
}
