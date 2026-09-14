import { cp, mkdir, readFile, readdir, rm, lstat } from 'node:fs/promises'
import { join, relative, isAbsolute, resolve } from 'node:path'

// Only this private, managed root is rewritten on startup. User-authored
// presets live in DSH's separate .agent-presets root and are never touched.
export async function prepareProductPresets({ product, home }) {
  const library = resolve(product, 'd/presets')
  const active = resolve(home, 'product-presets')
  const rel = relative(resolve(home), active)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid managed preset root')
  const entry = await lstat(active).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (entry?.isSymbolicLink() || (entry && !entry.isDirectory())) throw new Error('Managed preset root must be a directory')
  await mkdir(active, { recursive: true })
  const directories = await readdir(library, { withFileTypes: true })
  for (const directory of directories) {
    if (!directory.isDirectory()) continue
    const target = join(active, directory.name)
    const current = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (current?.isSymbolicLink()) throw new Error('Managed preset entry must not be a link')
    // Off until brand-settings applies the saved preference; standard and PTC
    // are ready before the Host scans its first roster.
    if (['minimal', 'cordis'].includes(directory.name)) {
      if (current) await rm(target, { recursive: true, force: true })
    } else {
      await readFile(join(library, directory.name, 'agent.cordis.yml'))
      await cp(join(library, directory.name), target, { recursive: true, force: true })
    }
  }
  return { DSH_PRODUCT_PRESET_DIR: active, DSH_PRODUCT_PRESET_LIBRARY_DIR: library }
}
