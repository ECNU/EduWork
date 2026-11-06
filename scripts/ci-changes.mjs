import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { selectProductChecks } from './packages/catalog.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value)

export function receiptInputs(receipt) {
  if (receipt?.schemaVersion !== 1 || receipt.kind !== 'eduwork-public-source-snapshot' || receipt.edition !== 'generic'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(receipt.version ?? '')
    || !Number.isFinite(Date.parse(receipt.createdAt)) || !/^[a-f0-9]{64}$/.test(receipt.fileSetSHA256 ?? '')
    || !Array.isArray(receipt.files) || !receipt.files.length
    || receipt.files.some(file => typeof file.path !== 'string' || !file.path || !/^[a-f0-9]{64}$/.test(file.sha256 ?? ''))
    || new Set(receipt.files.map(file => file.path)).size !== receipt.files.length) {
    throw new Error('Invalid source receipt identity, version or file hashes')
  }
  const { createdAt, fileSetSHA256, files, ...inputs } = receipt
  return inputs
}

export function readChanges(directory, { eventName, event = {}, base, head } = {}) {
  const full = reason => ({ files: [], full: true, reason })
  const git = args => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
  if (!eventName && base) {
    try {
      base = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim()
      head = git(['rev-parse', 'HEAD']).trim()
      eventName = 'pull_request'
    } catch { return full('Comparison commit unavailable; running all checks') }
  }
  if (!['pull_request', 'push'].includes(eventName)) return full('Manual or reusable validation runs all checks')
  base ??= eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before
  head ??= eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after
  if (!sha(base) || !sha(head)) return full('Missing comparison commit; running all checks')
  try {
    // A push includes every commit since before; PRs include only their branch changes.
    const comparisonBase = eventName === 'pull_request' ? git(['merge-base', base, head]).trim() : base
    const files = git(['diff', '--no-renames', '--name-only', '-z', comparisonBase, head, '--']).split('\0').filter(Boolean)
    let receiptOnly = false
    if (files.includes('source-receipt.json')) {
      const before = receiptInputs(JSON.parse(git(['show', `${comparisonBase}:source-receipt.json`])))
      const after = receiptInputs(JSON.parse(git(['show', `${head}:source-receipt.json`])))
      receiptOnly = isDeepStrictEqual(before, after)
    }
    return { files, receiptOnly, comparisonBase, head }
  } catch {
    return full('Comparison or receipt baseline unavailable; running all checks')
  }
}

export function selectChanges(directory = root, env = process.env, base) {
  // Validate the checked-out receipt even when assembly is skipped; checkout hashes need not be a frozen snapshot.
  receiptInputs(JSON.parse(readFileSync(resolve(directory, 'source-receipt.json'), 'utf8')))
  const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {}
  const changes = readChanges(directory, { eventName: env.GITHUB_EVENT_NAME, event, base, head: event.after || (env.GITHUB_EVENT_NAME === 'push' ? env.GITHUB_SHA : undefined) })
  return { ...selectProductChecks(changes.files, changes), comparison: changes }
}

export function writeSelection(selection, output = process.env.GITHUB_OUTPUT) {
  if (output) for (const name of ['build', 'integration', 'groups', 'packages']) appendFileSync(output, `${name}=${JSON.stringify(selection[name])}\n`)
  console.log(JSON.stringify(selection, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeSelection(selectChanges())
