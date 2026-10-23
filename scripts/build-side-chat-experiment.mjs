// Explicit local experiment. Preserve the approved npm install and compiler;
// derive a separately receipted Runtime with only the declared source changes.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { deriveRuntimeBundle, extensionPackages, prepareRuntimeExtension, runtimeCommit, runtimeVersion } from '../packages/dsh-side-chat/runtime-extension.mjs'
import { patchChatUserContentRuntime } from './patch-chat-user-content-runtime.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const sha256 = data => createHash('sha256').update(data).digest('hex')

function functionNode(ts, source, name) {
  let found
  const visit = node => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name?.text === name) {
      if (found) throw new Error(`Ambiguous Runtime function: ${name}`)
      found = node
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!found) throw new Error(`Runtime function missing: ${name}`)
  return found
}

function replaceOnce(input, before, after) {
  if (input.split(before).length !== 2) throw new Error(`Experimental client anchor changed: ${before.slice(0, 100)}`)
  return input.replace(before, after)
}

async function deriveUserActions({ runtime, ts }) {
  const filename = join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js')
  let bundle = (await readFile(filename, 'utf8')).replaceAll('\r\n', '\n')
  const parsed = ts.createSourceFile('chat.js', bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const fn = functionNode(ts, parsed, 'UserMessageNodeView')
  let body = bundle.slice(fn.getStart(parsed), fn.end)
  body = replaceOnce(body, 'node, renderFactorySlot, loadImage, t', 'node, renderSlot, renderFactorySlot, loadImage, t')
  body = replaceOnce(body, 'clock: "start",', 'clock: "start",\nextraActions: renderSlot("conversation.chat.user.actions", { seq: node.anchorSeq }),')
  bundle = bundle.slice(0, fn.getStart(parsed)) + body + bundle.slice(fn.end)
  bundle = replaceOnce(bundle, 'key: "user",\n\t\t\t\tlocale: NS', 'key: "user",\n\t\t\t\tchildren: { "conversation.chat.user.actions": { kind: "list", scope: "session" } },\n\t\t\t\tlocale: NS')
  await writeFile(filename, bundle)
  return { file: '@deepseek-ai/dsh-client-ui-chat/lib/client.js', sha256: sha256(bundle) }
}

async function deriveTemporaryTabPersistence({ runtime, compiler, ts, esbuild }) {
  const filename = join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js')
  let bundle = await readFile(filename, 'utf8')
  const input = await readFile(join(compiler, 'packages/client/ui-sidebar-right/src/client/persistence.ts'), 'utf8')
  const parsed = ts.createSourceFile('persistence.ts', input, ts.ScriptTarget.Latest, true)
  const original = functionNode(ts, parsed, 'writeSidebarLayout')
  let text = input.slice(original.getStart(parsed), original.end).replace(/^export\s+/, '')
  text = replaceOnce(text, '  const saved =', `  const temporary = Object.values(surface.layout.tabs).filter(tab => tab.kind === 'eduwork-side-chat')
  const layout = replay(surface.layout, temporary.map(tab => ({ type: 'closeTab', tabId: tab.id })))
  const saved =`)
  text = replaceOnce(text, 'layout: surface.layout', 'layout')
  const transformed = await esbuild.transform(text, { loader: 'ts', target: 'es2022', format: 'esm' })
  const replacement = transformed.code.replace(/\breplay\(/g, '(0, _deepseek_ai_dsh_client_ui_dockkit.replay)(')
  const parsedBundle = ts.createSourceFile('sidebar.js', bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const fn = functionNode(ts, parsedBundle, 'writeSidebarLayout')
  bundle = bundle.slice(0, fn.getStart(parsedBundle)) + replacement + bundle.slice(fn.end)
  await writeFile(filename, bundle)
  return { file: '@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js', sha256: sha256(bundle) }
}

export async function deriveConversationStore({ runtime, source, ts, esbuild, packageName = '@deepseek-ai/dsh-client-ui-conversation' }) {
  const filename = join(runtime, 'node_modules', packageName, 'lib/client.js')
  let bundle = await readFile(filename, 'utf8')
  const input = await readFile(join(source, 'client/ui-conversation/src/client/stores.ts'), 'utf8')
  const parsedInput = ts.createSourceFile('stores.ts', input, ts.ScriptTarget.Latest, true)
  for (const name of ['createConversationStore', 'readConversationDraft', 'readConversationViewPreference']) {
    const node = functionNode(ts, parsedInput, name)
    const text = input.slice(node.getStart(parsedInput), node.end).replace(/^export\s+/, '')
    const transformed = await esbuild.transform(text, { loader: 'ts', target: 'es2022', format: 'esm' })
    const replacement = transformed.code.replace(/\bdefineStore\b/g, '(0, _deepseek_ai_dsh_client_store.defineStore)')
    const parsedBundle = ts.createSourceFile('client.js', bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const original = functionNode(ts, parsedBundle, name)
    bundle = bundle.slice(0, original.getStart(parsedBundle)) + replacement + bundle.slice(original.end)
  }
  await writeFile(filename, bundle)
  return { file: `${packageName}/lib/client.js`, sha256: sha256(bundle) }
}

export async function buildSideChatExperiment({ runtime, compiler, output }) {
  runtime = resolve(runtime); compiler = resolve(compiler); output = resolve(output)
  const base = await json(join(runtime, '.chatecnu-dsh-runtime.json'))
  const tools = await json(join(compiler, '.eduwork-build-tools.json'))
  const lock = await json(join(repository, 'third_party/dsh/candidate-v0.2.1-rc.2/LOCK.json'))
  if (base.source !== 'npm-lock' || base.dshCommit !== runtimeCommit || base.dshVersion !== runtimeVersion
    || base.packageLockSHA256 !== lock.runtime.npm.packageLockSHA256
    || tools.dshCommit !== runtimeCommit || tools.dshVersion !== runtimeVersion) {
    throw new Error('Side-chat experiment requires the approved npm Runtime and prepared pinned compiler')
  }
  const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) }
  if (inside(runtime, output) || inside(output, runtime) || inside(compiler, output) || inside(output, compiler)) {
    throw new Error('Experiment output must be independent of its inputs')
  }
  await mkdir(output)
  const source = join(output, 'runtime-extension-source')
  const sources = await prepareRuntimeExtension({ sourceRoot: compiler, output: source })
  const targetRuntime = join(output, 'runtime')
  console.log('Copying the verified npm Runtime into the explicit experiment output')
  await cp(runtime, targetRuntime, { recursive: true })
  const toolRequire = createRequire(join(compiler, 'package.json'))
  const runtimeRequire = createRequire(join(runtime, 'package.json'))
  const ts = toolRequire('typescript')
  const esbuild = runtimeRequire('esbuild')
  const outputs = []
  for (const entry of extensionPackages.filter(entry => entry.face === 'host')) {
    const filename = join(targetRuntime, 'node_modules', entry.name, 'lib/index.js')
    const input = await readFile(filename)
    const derived = deriveRuntimeBundle(entry.name, input)
    // Preserve the official compiler's cross-package const-enum lowering and
    // module identities. Syntax-check the reviewed derivative without bundling
    // package source against incompatible runtime-only vendor exports.
    await esbuild.transform(derived, { loader: 'js', target: 'node24', format: 'esm' })
    await writeFile(filename, derived)
    outputs.push({ file: `${entry.name}/lib/index.js`, sha256: sha256(await readFile(filename)) })
  }
  outputs.push(await deriveConversationStore({ runtime: targetRuntime, source, ts, esbuild }))
  const decoration = await patchChatUserContentRuntime(join(targetRuntime, 'node_modules'))
  outputs.push(await deriveUserActions({ runtime: targetRuntime, ts }))
  outputs.push(await deriveTemporaryTabPersistence({ runtime: targetRuntime, compiler, ts, esbuild }))
  const receipt = {
    schemaVersion: 1, kind: 'eduwork-side-chat-experiment', experimental: true,
    baseRuntime: { dshCommit: base.dshCommit, dshVersion: base.dshVersion, packageLockSHA256: base.packageLockSHA256 },
    compiler: { dshCommit: tools.dshCommit, nodeVersion: tools.nodeVersion, pnpmVersion: tools.pnpmVersion },
    nodeVersion: process.version, implementation: 'reviewed-published-bundle-derivatives', sources, outputs, decoration,
  }
  await writeFile(join(targetRuntime, '.eduwork-side-chat-experiment.json'), JSON.stringify(receipt, null, 2) + '\n')
  // Do not allow the derivative to masquerade as an approved npm cache.
  await writeFile(join(targetRuntime, '.chatecnu-dsh-runtime.json'), JSON.stringify({
    ...base, source: 'experimental-side-chat', experimentalReceipt: '.eduwork-side-chat-experiment.json',
  }, null, 2) + '\n')
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  return { runtime: targetRuntime, receipt }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: Object.fromEntries(['runtime', 'compiler', 'output'].map(key => [key, { type: 'string' }])) })
  for (const key of ['runtime', 'compiler', 'output']) if (!values[key]) throw new Error(`Missing --${key}`)
  const result = await buildSideChatExperiment(values)
  console.log(JSON.stringify({ runtime: result.runtime, experimental: true, outputs: result.receipt.outputs }, null, 2))
}
