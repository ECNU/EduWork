import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export function portableSourceHintPath(localAppData, distribution) {
  return join(localAppData, 'EduWork', `${distribution}.portable-source.json`)
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
