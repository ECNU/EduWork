import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
            try { intents.remove(intent.id) } catch { /* Preserve recoverable intent */ }
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
  if (mode === 'install') {
    const digest = installer.algorithm === 'sha512' ? Buffer.from(installer.digest, 'base64').toString('hex') : installer.digest
    args.push('--installer', installerPath, '--bytes', String(installer.bytes), '--algorithm', installer.algorithm, '--digest', digest, '--intent', intentId)
  }
  await run(helper, args, { windowsHide: true, timeout: 15000 })
}
