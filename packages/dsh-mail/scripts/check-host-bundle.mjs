import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { matchesGlob } from 'node:path'
import net from 'node:net'
import tls from 'node:tls'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const publishedRuntimeDependencies = Object.keys(manifest.dependencies ?? {})
if (publishedRuntimeDependencies.length > 0) {
  throw new Error(
    `Host runtime must stay self-contained; move build-only packages to devDependencies instead of publishing runtime dependencies: ${publishedRuntimeDependencies.join(', ')}`,
  )
}

const lib = new URL('../lib/', import.meta.url)
for (const file of await readdir(lib, { recursive: true })) {
  if (!/\.(?:c|m)?js$/.test(file)) continue
  assert.ok(manifest.files.some(pattern => matchesGlob(`lib/${file}`, pattern)), `Runtime chunk is missing from the published package: ${file}`)
  const source = await readFile(new URL(file, lib), 'utf8')
  for (const specifier of ['imapflow', 'mailparser', 'nodemailer', 'schemastery', '@deepseek-ai/schemastery']) {
    const bareImport = new RegExp(`(?:from\\s*|import\\s*\\(|require\\s*\\()(['\"])${specifier}(?:/[^'\"]*)?\\1`)
    if (bareImport.test(source)) {
      throw new Error(`Host bundle still depends on external runtime package: ${specifier} in ${file}`)
    }
  }
}

let executingConfiguredTool = false, networkImports = 0, connections = 0
let cancelDuringImport
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (/^(?:node:)?(?:net|tls|dns)$/.test(specifier)) {
    assert.ok(executingConfiguredTool, 'Mail protocol libraries loaded before a configured tool execution')
    networkImports++
    cancelDuringImport?.abort(new Error('Mail operation cancelled during import'))
  }
  return nextResolve(specifier, context)
} })
const connect = () => { connections++; throw new Error('Unexpected network access in bundle check') }
const original = { connect: net.connect, createConnection: net.createConnection, tls: tls.connect }
net.connect = net.createConnection = tls.connect = connect
try {
  const module = await import(new URL(`../lib/index.js?bundle-check=${Date.now()}`, import.meta.url))
  assert.equal(module.name, 'dsh-mail-assistant')
  assert.equal(typeof module.apply, 'function')
  const registered = new Map()
  const settings = { ...module.DEFAULTS }
  let credential
  let guard
  module.apply({
    settings: { register: () => ({ get: () => settings }) },
    credentials: { resolve: async () => credential },
    tools: { register: tool => registered.set(tool.name, tool), guard: value => { guard = value } },
    fs: { resolve: async path => path },
    on() {}, inject() {},
  })
  assert.equal(registered.size, 5)
  assert.match(guard({ name: 'mail_find' }), /reading is disabled/)
  assert.match(guard({ name: 'mail_send' }), /sending is disabled/)
  const abortedExec = { signal: AbortSignal.abort(new Error('Mail operation cancelled')),
    agent: { session: { header: { cwd: process.cwd() } } } }
  const activeExec = { ...abortedExec, signal: new AbortController().signal }
  const execute = (exec, name, args) => registered.get(name).execute(args, exec)
  await assert.rejects(execute(abortedExec, 'mail_find', {}), /Mail assistant is not configured/)
  Object.assign(settings, { email: 'user@example.com', imapHost: 'imap.example.test', smtpHost: 'smtp.example.test' })
  await assert.rejects(execute(abortedExec, 'mail_find', {}), /Mail password is not configured/)
  assert.equal(networkImports, 0)

  credential = { value: 'synthetic-password' }
  await assert.rejects(execute(abortedExec, 'mail_find', { cursor: 'invalid' }), /Mail operation cancelled/)
  assert.equal(networkImports, 0, 'A previously cancelled call must not load protocol libraries')
  cancelDuringImport = new AbortController()
  executingConfiguredTool = true
  await assert.rejects(execute({ ...activeExec, signal: cancelDuringImport.signal }, 'mail_find', { cursor: 'invalid' }), /Mail operation cancelled during import/)
  assert.equal(cancelDuringImport.signal.aborted, true)
  assert.ok(networkImports > 0, 'First use must load the bundled mail client')
  await assert.rejects(execute(activeExec, 'mail_find', { cursor: 'invalid' }), /Invalid mail handle/)
  await assert.rejects(execute(abortedExec, 'mail_list_folders', {}), /Mail operation cancelled/)
  await assert.rejects(execute(activeExec, 'mail_read', { handle: 'invalid' }), /Invalid mail handle/)
  await assert.rejects(execute(activeExec, 'mail_get_attachment', { handle: 'invalid' }), /Invalid mail handle/)
  await assert.rejects(execute(abortedExec, 'mail_send', { to: ['recipient@example.com'], subject: 'Synthetic', text: 'Cancelled' }), /Mail operation cancelled/)
  assert.equal(connections, 0, 'Cancelled first use must not open an IMAP or SMTP connection')
} finally {
  hooks.deregister()
  net.connect = original.connect
  net.createConnection = original.createConnection
  tls.connect = original.tls
}
