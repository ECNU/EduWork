import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SKIN, LIMITS, imageProblem, normalizeSkin } from './skin.js'

const MIME = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp' }

/** Read one skin directory: manifest, every referenced image and the limits. */
export async function readSkin(directory, { strict = false } = {}) {
  const regular = async name => {
    const info = await lstat(join(directory, name))
    if (!info.isFile()) throw new Error(`形象包无效：${name} 必须是普通文件`)
    return info.size
  }
  let total = await regular('skin.json')
  if (total > LIMITS.manifestBytes) throw new Error('形象包无效：skin.json 过大')
  const skin = normalizeSkin(JSON.parse(await readFile(join(directory, 'skin.json'), 'utf8')), { strict })
  for (const name of skin.files) {
    total += await regular(name)
    if (total > LIMITS.packageBytes) throw new Error('形象包无效：超过 20 MB')
    const problem = imageProblem(name, await readFile(join(directory, name)))
    if (problem) throw new Error(`形象包无效：${name} ${problem}`)
  }
  return skin
}

/** Small card image for the settings page: the first idle frame. */
export async function skinPreview(directory, skin) {
  const { file, crop } = skin.animations.idle.frames[0]
  const data = await readFile(join(directory, file))
  return { src: `data:${MIME[file.split('.').pop().toLowerCase()]};base64,${data.toString('base64')}`, crop: crop ?? null }
}

/**
 * Built-in skins ship inside this package and are checked strictly. One
 * invalid directory is reported and skipped; the others stay available.
 */
export async function readBuiltinSkins(root, warn) {
  const skins = new Map()
  // The default character and its palettes come first, the others by id.
  const rank = name => name.startsWith(DEFAULT_SKIN) ? 0 : 1
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = join(root, entry.name)
    try {
      const skin = await readSkin(directory, { strict: true })
      if (skin.id !== entry.name) throw new Error(`形象包无效：id ${skin.id} 与目录名不同`)
      skins.set(skin.id, { skin, preview: await skinPreview(directory, skin) })
    } catch (error) { warn(`desktop-pet: skipped ${entry.name}: ${error.message}`) }
  }
  return skins
}
