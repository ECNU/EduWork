// Inject the built side-chat plugin into an existing EduWork product.
// No Runtime patches — just copies the plugin package and updates composition.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const save = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export async function injectSideChat({ product, pluginRoot }) {
  product = resolve(product)
  pluginRoot = pluginRoot ? resolve(pluginRoot) : join(repository, 'packages/dsh-side-chat')

  const manifest = await json(join(pluginRoot, 'package.json'))
  if (manifest.name !== '@eduwork/dsh-side-chat') throw new Error('Expected @eduwork/dsh-side-chat package')

  for (const required of ['lib/index.js', 'lib/client.js']) {
    try { await readFile(join(pluginRoot, required)) }
    catch { throw new Error(`Missing built file: ${required}. Run npm run build in the plugin directory first.`) }
  }

  const modules = join(product, 'd/node_modules')
  const target = join(modules, '@eduwork/dsh-side-chat')
  await mkdir(target, { recursive: true })

  for (const file of ['lib/index.js', 'lib/client.js', 'package.json', 'cordis.patch.yml']) {
    const source = join(pluginRoot, file)
    const dest = join(target, file)
    await mkdir(dirname(dest), { recursive: true })
    await cp(source, dest)
  }

  const runtimeManifest = await json(join(product, 'd/package.json'))
  runtimeManifest.dependencies ??= {}
  runtimeManifest.dependencies[manifest.name] = manifest.version
  await save(join(product, 'd/package.json'), runtimeManifest)

  const compositionPath = join(product, 'composition.json')
  const composition = await json(compositionPath)
  const alreadyInserted = composition.some(entry =>
    entry.insert?.some(item => item.id === 'eduwork-side-chat'))
  if (!alreadyInserted) {
    composition.push({ insert: [{ id: 'eduwork-side-chat', name: manifest.name }] })
    await save(compositionPath, composition)
  }

  const files = await Promise.all(
    ['lib/index.js', 'lib/client.js', 'package.json'].map(async path => ({
      path, sha256: sha256(await readFile(join(target, path))),
    })))

  const receipt = {
    schemaVersion: 1, kind: 'eduwork-side-chat-plugin-injection',
    package: { name: manifest.name, version: manifest.version },
    files, injectedAt: new Date().toISOString(),
  }
  await save(join(product, 'd/.eduwork-side-chat-injection.json'), receipt)

  console.log(`Side-chat plugin injected into ${product}`)
  console.log(JSON.stringify(receipt, null, 2))
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      product: { type: 'string' },
      'plugin-root': { type: 'string' },
    },
  })
  if (!values.product) throw new Error('Missing --product <path-to-assembled-product>')
  await injectSideChat({ product: values.product, pluginRoot: values['plugin-root'] })
}
