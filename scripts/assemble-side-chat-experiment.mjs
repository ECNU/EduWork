// Add the unpublished side-chat tarball and explicitly receipted Runtime
// derivatives to a fresh copy of a normal, independently assembled product.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { deriveConversationStore } from './build-side-chat-experiment.mjs'

const json = async path => JSON.parse(await readFile(path, 'utf8'))
const save = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, value) => { const rel = relative(root, value); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) }

export async function assembleSideChatExperiment({ baseProduct, experiment, compiler, tarball, output }) {
  baseProduct = resolve(baseProduct); experiment = resolve(experiment); compiler = resolve(compiler); output = resolve(output); tarball = resolve(tarball)
  for (const input of [baseProduct, experiment, compiler]) {
    if (inside(input, output) || inside(output, input)) throw new Error('Experimental product must be separate from every input')
  }
  const identity = await json(join(baseProduct, 'assembly.json'))
  const extension = await json(join(experiment, 'receipt.json'))
  if (identity.kind !== 'eduwork-web' || identity.runtimeMode !== 'npm' || identity.experimental
    || identity.dshVersion !== extension.baseRuntime.dshVersion || identity.dshCommit !== extension.baseRuntime.dshCommit) {
    throw new Error('Use a normal product matching the explicit experiment baseline')
  }
  await mkdir(output)
  await cp(baseProduct, output, { recursive: true })
  const modules = join(output, 'd/node_modules')
  const experimentalModules = join(experiment, 'runtime/node_modules')
  for (const file of extension.outputs) {
    if (!/^@deepseek-ai\/[a-z-]+\/lib\/[a-z.]+$/.test(file.file)) throw new Error('Unexpected Runtime extension path')
    const bytes = await readFile(join(experimentalModules, file.file))
    if (sha256(bytes) !== file.sha256) throw new Error(`Runtime extension hash mismatch: ${file.file}`)
    await writeFile(join(modules, file.file), bytes)
  }
  // Product branding derives the Conversation module under its own identity;
  // its stores must follow the same temporary-session rule as the official one.
  const require = createRequire(join(compiler, 'package.json'))
  const runtimeRequire = createRequire(join(experiment, 'runtime/package.json'))
  const branded = await deriveConversationStore({
    runtime: join(output, 'd'), source: join(experiment, 'runtime-extension-source'),
    ts: require('typescript'), esbuild: runtimeRequire('esbuild'),
    packageName: '@chatecnu-work/dsh-client-ui-conversation-brand',
  })
  const packageRoot = join(modules, '@eduwork/dsh-side-chat')
  await mkdir(dirname(packageRoot), { recursive: true })
  await mkdir(packageRoot)
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe') : 'tar'
  await promisify(execFile)(tar, ['-xzf', tarball, '-C', packageRoot, '--strip-components=1'], { windowsHide: true })
  const manifest = await json(join(packageRoot, 'package.json'))
  if (manifest.name !== '@eduwork/dsh-side-chat' || manifest.private !== true) throw new Error('Use the unpublished experimental side-chat tarball')
  const composition = await json(join(output, 'composition.json'))
  composition.push({ insert: [{ id: 'eduwork-side-chat', name: manifest.name }] })
  await save(join(output, 'composition.json'), composition)
  const runtimeManifest = await json(join(output, 'd/package.json'))
  runtimeManifest.dependencies[manifest.name] = manifest.version
  await save(join(output, 'd/package.json'), runtimeManifest)
  const localPackage = {
    name: manifest.name, version: manifest.version, source: 'local-npm-pack',
    tarballSHA256: sha256(await readFile(tarball)),
    files: await Promise.all(['lib/index.js', 'lib/client.js', 'package.json'].map(async path => ({ path, sha256: sha256(await readFile(join(packageRoot, path))) }))),
  }
  const receipt = { ...extension, kind: 'eduwork-side-chat-experimental-product', branded, localPackage }
  const runtimeIdentity = await json(join(output, 'd/.chatecnu-dsh-runtime.json'))
  await save(join(output, 'd/.chatecnu-dsh-runtime.json'), { ...runtimeIdentity, source: 'experimental-side-chat', experimentalReceipt: '.eduwork-side-chat-experiment.json' })
  await save(join(output, 'd/.eduwork-side-chat-experiment.json'), receipt)
  await save(join(output, 'assembly.json'), {
    ...identity, runtimeMode: 'experimental-side-chat', pluginMode: 'npm-with-experimental-side-chat',
    experimental: true, sourceAlpha: true, automaticUpdates: false, published: false, sideChatExperiment: receipt,
  })
  return { product: output, receipt }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: Object.fromEntries(['base-product', 'experiment', 'compiler', 'tarball', 'output'].map(key => [key, { type: 'string' }])) })
  for (const key of ['base-product', 'experiment', 'compiler', 'tarball', 'output']) if (!values[key]) throw new Error(`Missing --${key}`)
  const result = await assembleSideChatExperiment({ baseProduct: values['base-product'], experiment: values.experiment, compiler: values.compiler, tarball: values.tarball, output: values.output })
  console.log(JSON.stringify({ product: result.product, experimental: true, package: result.receipt.localPackage }, null, 2))
}
