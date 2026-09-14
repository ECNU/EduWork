import { appendFileSync, statSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Shell-owned path; log failures must not break startup or protocol delivery. */
export function desktopLogger(path) {
  return value => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      try { if (statSync(path).size > 2 * 1024 * 1024) renameSync(path, path + '.1') } catch {}
      appendFileSync(path, String(value), { mode: 0o600 })
    } catch { /* Diagnostics remain best effort when the disk is full/read-only. */ }
  }
}
