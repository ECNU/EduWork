import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export function portableSourceHintPath(localAppData, distribution) {
  return join(localAppData, 'EduWork', `${distribution}.portable-source.json`)
}

export function portableMigrationNotice({ distribution, version, releasesURL }) {
  const installerURL = distribution === 'eduwork' ? `https://github.com/ecnu/EduWork/releases/tag/v${version}` : releasesURL
  if (!installerURL) return undefined
  const url = new URL(installerURL)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Migration installer URL must be HTTPS')
  return { installerURL: url.href }
}

export async function writePortableSourceHint({ localAppData, distribution, root, version, now = () => new Date() }) {
  if (!localAppData || !isAbsolute(localAppData) || !isAbsolute(root)) throw new Error('Portable source hint requires absolute paths')
  if (!/^[a-z0-9-]+$/.test(distribution) || typeof version !== 'string' || !version) throw new Error('Portable source identity is invalid')
  const path = portableSourceHintPath(localAppData, distribution)
  await mkdir(join(localAppData, 'EduWork'), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const value = { schemaVersion: 1, distribution, root, version, updatedAt: now().toISOString() }
  try {
    await writeFile(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  return path
}

export async function readPortableSourceHint({ localAppData, distribution }) {
  if (!localAppData || !isAbsolute(localAppData)) return null
  try {
    const value = JSON.parse(await readFile(portableSourceHintPath(localAppData, distribution), 'utf8'))
    const keys = Object.keys(value).sort()
    if (JSON.stringify(keys) !== JSON.stringify(['distribution', 'root', 'schemaVersion', 'updatedAt', 'version'])
      || value.schemaVersion !== 1 || value.distribution !== distribution || !isAbsolute(value.root)
      || typeof value.version !== 'string' || !value.version
      || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null
    return value
  } catch { return null }
}

export async function portableSourceSuggestion({ localAppData, distribution, validate }) {
  const hint = await readPortableSourceHint({ localAppData, distribution })
  if (!hint) return undefined
  try { return (await validate(hint.root)).root }
  catch { return undefined }
}
