import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { portableSourceHintPath } from './portable-source-hint.mjs'

export async function writePortableSourceHint({ localAppData, distribution, root, version }) {
  if (!isAbsolute(localAppData || '') || !isAbsolute(root || '') || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(distribution ?? '') || !version) return
  const path = portableSourceHintPath(localAppData, distribution)
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  try {
    const value = { schemaVersion: 1, distribution, root, version, updatedAt: new Date().toISOString() }
    await writeFile(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
    return path
  } finally { await unlink(temporary).catch(() => {}) }
}

export function createPortableMigration({ source, discover, download, reserve, preflight, inspectTasks, confirm, stop, intents,
  launch, quit, fail, cleanup, now = Date.now }) {
  if (!source) return null
  let policy, candidate, pending, nextCheck = 0, dismissed = false, operation
  const synchronize = update => {
    const next = update?.enabled && update.userEnabled ? update.policy : undefined
    if (policy !== next) {
      policy = next
      candidate = pending = undefined
      nextCheck = 0
      dismissed = false
    }
    return policy
  }
  return {
    get busy() { return Boolean(operation) },
    check(update) {
      const channel = synchronize(update)
      if (!channel || operation || now() < nextCheck) return
      if (pending) return pending
      let request
      request = (async () => discover(channel))().then(installer => {
        if (pending !== request) return
        candidate = installer
        nextCheck = now() + 15 * 60_000
      }, () => {
        if (pending !== request) return
        candidate = undefined
        nextCheck = now() + 2 * 60_000
      }).finally(() => { if (pending === request) pending = undefined })
      return pending = request
    },
    state(update) {
      if (synchronize(update) && candidate) return { version: candidate.version, dismissed, busy: Boolean(operation) }
    },
    dismiss(update) { if (synchronize(update)) dismissed = true },
    start(update) {
      if (operation || !synchronize(update) || !candidate) return
      const installer = candidate
      operation = (async () => {
        let release, intent, executable, stopped = false, launched = false
        try {
          release = await reserve()
          executable = await download(installer)
          const portable = await preflight()
          const active = await inspectTasks()
          if (!await confirm()) return
          await stop(active)
          stopped = true
          intent = await intents.write({ sourceRoot: portable.root, sourceVersion: portable.version, installerVersion: installer.version })
          await launch(executable, installer, intent)
          launched = true
          quit()
        } catch (error) {
          if (intent) {
            try {
              const releaseIntent = await intents.claim?.(intent.id)
              try { intents.remove(intent.id) } finally { await releaseIntent?.() }
            } catch { /* Preserve recoverable intent */ }
          }
          await fail(error, stopped)
        } finally {
          if (executable && !launched) await cleanup?.(executable)
          release?.()
        }
      })().finally(() => { operation = undefined })
      return operation
    },
  }
}

export async function launchPortableMigrationHelper({ helper, mode, distribution, parentPid = process.pid, installerPath, installer, intentId, run = promisify(execFile) }) {
  const args = ['portable-migration', '--mode', mode, '--distribution', distribution, '--parent-pid', String(parentPid)]
  if (intentId) args.push('--intent', intentId)
  if (mode === 'install') {
    const digest = installer.algorithm === 'sha512' ? Buffer.from(installer.digest, 'base64').toString('hex') : installer.digest
    args.push('--installer', installerPath, '--bytes', String(installer.bytes), '--algorithm', installer.algorithm, '--digest', digest)
  }
  await run(helper, args, { windowsHide: true, timeout: 15000 })
}
