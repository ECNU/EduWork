import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, join, sep, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

/** Record only bundled Skills before code signing; no mutable user content. */
export async function writeBundledSkillsManifest({ root, product, output }) {
  root = resolve(root); product = resolve(product); output = resolve(output)
  const local = path => {
    const name = relative(root, path)
    if (!name || isAbsolute(name) || name === '..' || name.startsWith('..' + sep)) throw Error('Manifest inputs and output must stay inside the app bundle')
    return name.split(sep).join('/')
  }
  local(output)
  const files = []
  const walk = async folder => {
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Bundled Skills must use real directories')
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, item.name)
      if (item.isSymbolicLink()) throw Error('Bundled Skills must not contain filesystem links')
      if (item.isDirectory()) await walk(path)
      else if (item.isFile()) {
        const bytes = await readFile(path)
        files.push({ path: local(path), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
      } else throw Error('Unsupported bundled Skill input')
    }
  }
  const skills = join(product, 'skills')
  local(skills)
  await walk(skills)
  if (!files.length) throw Error('Bundled Skills manifest must not be empty')
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  const manifest = { schemaVersion: 1, kind: 'bundled-skills', files }
  await writeFile(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, product: { type: 'string' }, output: { type: 'string' } } })
  if (!values.root || !values.product || !values.output) throw Error('Use --root <app> --product <product> --output <manifest>')
  const manifest = await writeBundledSkillsManifest(values)
  console.log(`Recorded ${manifest.files.length} bundled Skill files`)
}
