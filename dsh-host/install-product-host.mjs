import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, isDeepStrictEqual } from 'node:util'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export async function installProductHost({ product, adapter }) {
  product = resolve(product); adapter = resolve(adapter)
  if (/(?:^|[\\/])current(?:[\\/]|$)/i.test(product)) throw new Error('Prepare the desktop Host in a new product assembly')
  const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
  const receipt = JSON.parse(await readFile(join(adapter, 'receipt.json'), 'utf8'))
  if (identity.dshCommit !== receipt.upstreamCommit || identity.dshVersion !== receipt.upstreamVersion) throw new Error('Product and desktop Host baselines differ')
  const files = []
  for (const [path, expected] of Object.entries(receipt.outputs)) {
    if (!path.startsWith('desktop-host/')) continue
    const bytes = await readFile(join(adapter, path))
    if (hash(bytes) !== expected) throw new Error('Prepared desktop Host differs from its source receipt')
    const target = join(product, 'd/node_modules/@deepseek-ai/dsh-desktop-host', path.slice('desktop-host/'.length))
    const existing = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (existing && hash(existing) !== expected) throw new Error('Product already contains another desktop Host; use a new assembly')
    files.push({ path, target, existing })
  }
  if (!files.some(row => row.path === 'desktop-host/lib/index.js')) throw new Error('Desktop Host entry is missing from receipt')
  for (const { path, target, existing } of files) if (!existing) {
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(adapter, path), target)
  }
  const nativePlugins = {}
  const repository = resolve(import.meta.dirname, '..')
  for (const folder of ['credentials-native', 'desktop-boundary', 'desktop-services']) {
    const source = join(repository, 'dsh-plugins', folder)
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    // The Web-to-desktop preparation step pins DSH peers to the product's
    // frozen baseline. Apply the same projection before checking its payload.
    for (const name of Object.keys(manifest.peerDependencies || {})) {
      if (name.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[name] = identity.dshVersion
    }
    const destination = join(product, 'd/node_modules', manifest.name)
    const payload = ['package.json']
    const walk = async prefix => {
      for (const entry of await readdir(join(source, prefix), { withFileTypes: true })) {
        const path = prefix + '/' + entry.name
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile() && path.endsWith('.js')) payload.push(path)
      }
    }
    await walk('lib')
    const hashes = {}
    for (const path of payload) {
      const bytes = path === 'package.json'
        ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
        : await readFile(join(source, path))
      const expected = hash(bytes), target = join(destination, path)
      const existing = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error })
      // PowerShell emits CRLF JSON on Windows. Only the package manifest may
      // differ in formatting; executable files still require exact hashes.
      const equivalentManifest = existing && path === 'package.json' && isDeepStrictEqual(JSON.parse(existing.toString('utf8')), manifest)
      if (existing && hash(existing) !== expected && !equivalentManifest) throw new Error(`Product already contains another native adapter (${manifest.name}/${path}); use a new assembly`)
      if (!existing) { await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes) }
      hashes[path] = existing ? hash(existing) : expected
    }
    nativePlugins[manifest.name] = { version: manifest.version, files: hashes }
  }
  const metadata = { protocolVersion: receipt.protocolVersion, upstreamCommit: receipt.upstreamCommit,
    files: Object.fromEntries(Object.entries(receipt.outputs).filter(([path]) => path.startsWith('desktop-host/'))), nativePlugins }
  if (JSON.stringify(identity.desktopHost) !== JSON.stringify(metadata)) {
    identity.desktopHost = metadata
    await writeFile(join(product, 'assembly.json'), JSON.stringify(identity, null, 2) + '\n')
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { product: { type: 'string' }, adapter: { type: 'string' } } })
  if (!values.product || !values.adapter) throw new Error('Use --product <new-assembly> --adapter <verified-host>')
  await installProductHost(values)
  console.log('Verified official desktop Host installed in product.')
}
