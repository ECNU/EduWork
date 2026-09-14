import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as React from 'react'
import { MEMORY_REMOTE_DESCRIPTORS } from '../lib/typert.host.js'
import remote from '../lib/typert.remote-client.js'

test('published NOTICE includes the complete bundled Zod license', async () => {
  const require = createRequire(import.meta.url)
  const zodRoot = path.dirname(require.resolve('zod/package.json'))
  const license = (await readFile(path.join(zodRoot, 'LICENSE'), 'utf8')).replace(/\r\n/g, '\n').trim()
  const notice = (await readFile(new URL('../NOTICE', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.files.includes('NOTICE'), 'NOTICE must be included in the published package')
  assert.ok(notice.includes(license), 'retain the original copyright and full MIT terms')
})

test('published Client factory uses matching package and Remote contracts', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let registration
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { registration = value } } } })
  assert.equal(registration.id, '@eduwork/dsh-memory')
  const client = registration.factory(name => { assert.equal(name, 'react'); return React })
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual(MEMORY_REMOTE_DESCRIPTORS.map(x => x.id), remote.descriptors.map(x => x.id))
  for (const descriptor of remote.descriptors) assert.ok(descriptor.id.startsWith('@eduwork/dsh-memory#localMemories/'))
  assert.doesNotMatch(source, /@chatecnu-work|[A-Z]:\\\\Users\\\\|\.research/)
})
