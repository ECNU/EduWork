import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const valid = value => ['stable', 'development'].includes(value)
const read = async path => readFile(path, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null
  throw error
})
async function atomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

export function usesStableDefault(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version)
  return !!match && (Number(match[1]) > 0 || Number(match[2]) >= 4)
}

// Shared by Windows software, Sparkle and signed content before any checks or
// pending installs. The separate journal survives later source:user saves.
export async function migrateUpdateChannel({ dataRoot, version, fallback = 'stable' }) {
  const preferencesPath = join(dataRoot, 'state/update-preferences.json')
  const receiptPath = join(dataRoot, 'state/update-channel-040.json')
  let saved = await read(preferencesPath)
  if (saved && (saved.schemaVersion !== 1 || !valid(saved.policy))) throw new Error('更新渠道偏好文件无效，原文件已保留')
  if (!usesStableDefault(version)) return saved?.policy ?? fallback
  const receipt = await read(receiptPath)
  if (receipt?.schemaVersion === 1 && receipt.state === 'complete') {
    if (!saved) await atomic(preferencesPath, { schemaVersion: 1, policy: 'stable', source: 'packaged-default' })
    return saved?.policy ?? 'stable'
  }
  let journal = receipt
  if (journal) {
    if (journal.schemaVersion !== 1 || journal.state !== 'pending' || !valid(journal.after?.policy)
      || (!isDeepStrictEqual(saved, journal.before) && !isDeepStrictEqual(saved, journal.after))) {
      throw new Error('更新渠道迁移记录与偏好不一致，原文件已保留')
    }
  } else {
    const policy = saved?.source === 'user' ? saved.policy : 'stable'
    journal = { schemaVersion: 1, state: 'pending', version, before: saved,
      after: { schemaVersion: 1, policy, source: saved?.source === 'user' ? 'user' : 'packaged-default' } }
    await atomic(receiptPath, journal)
  }
  await atomic(preferencesPath, journal.after)
  await atomic(receiptPath, { ...journal, state: 'complete' })
  return journal.after.policy
}
