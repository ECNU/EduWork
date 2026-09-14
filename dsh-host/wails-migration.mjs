import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { importLegacyData } from './legacy-migration.mjs'

// This entry is invoked by the native launcher before starting a Host. Only
// the known portable legacy home may be imported, never a renderer-supplied path.
export async function prepareWailsLegacyHome({ root, distribution, version }) {
  root = await realpath(root)
  if (!/^[a-z0-9-]+$/.test(distribution)) throw Error('Invalid migration edition')
  const sourceHome = join(root, 'data', 'dsh')
  const targetHome = join(root, 'data', distribution + '-wails', 'dsh')
  const existing = await lstat(targetHome).catch(e => { if (e.code === 'ENOENT') return null; throw e })
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw Error('Invalid Wails data directory')
    const owner = await readFile(join(targetHome, '.eduwork-desktop-home.json'), 'utf8').then(JSON.parse).catch(() => null)
    const imported = await readFile(join(targetHome, '.eduwork-migration.json'), 'utf8').then(JSON.parse).catch(() => null)
    if (owner?.shell === 'wails' && owner.distribution === distribution || imported?.state === 'imported') return { state: 'existing' }
    const entries = await readdir(targetHome, { withFileTypes: true })
    // The withdrawn launcher let WebView create a cache before migration.
    // Preserve that failed-start cache separately; never treat user data as it.
    const bootstrapOnly = entries.length > 0 && entries.every(entry => entry.isDirectory() && !entry.isSymbolicLink() && ['webview2', 'logs'].includes(entry.name))
    const actual = await realpath(targetHome)
    const samePath = process.platform === 'win32' ? actual.toLowerCase() === targetHome.toLowerCase() : actual === targetHome
    if (!bootstrapOnly || !samePath) throw Error('目标数据目录已有内容，未自动合并。原数据仍保留，请检查数据目录。')
    await rename(targetHome, join(dirname(targetHome), '.startup-before-migration-' + randomUUID()))
  }
  const legacy = await lstat(sourceHome).catch(e => { if (e.code === 'ENOENT') return null; throw e })
  if (!legacy) return { state: 'new-install' }
  const id = createHash('sha256').update('wails-bridge-v1\n' + distribution + '\n' + sourceHome).digest('hex')
  const receipt = await importLegacyData({ root, targetHome, launch: { sourceHome, version, id } })
  return { state: 'imported', files: receipt.files.length, credentials: 'sign-in-required' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, distribution, version] = process.argv.slice(2)
  try { console.log(JSON.stringify(await prepareWailsLegacyHome({ root, distribution, version }))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
