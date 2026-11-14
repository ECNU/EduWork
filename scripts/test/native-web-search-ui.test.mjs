import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('native search settings preserve product defaults and expose registered providers', { skip: !runtime }, async () => {
  const client = await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-settings-web-search/lib/client.js'), 'utf8')
  let Controller
  // Expose the real published controller in this VM only; no product patch.
  const anchor = 'exports.NS=NS;'
  assert.equal(client.split(anchor).length, 2)
  runInNewContext(client.replace(anchor, 'exports.Controller = WebSearchCardController; ' + anchor), {
    window: { __ModuleLoader__: { load({ factory }) { Controller = factory(() => ({})).Controller } } },
  })
  const controller = Object.create(Controller.prototype)
  const edits = {}
  controller.scopes = { web: { getSnapshot: () => ({ base: { searchProvider: 'eduwork-search', fetchProvider: 'http' } }) } }
  controller.selection = { actions: () => ({ resetField: key => { edits[key] = 'reset' }, edit: (key, value) => { edits[key] = value } }) }
  controller.select('searchProvider', 'deepseek-search-api')
  assert.equal(edits.searchProvider, 'deepseek-search-api')
  controller.select('searchProvider', 'eduwork-search')
  controller.select('fetchProvider', 'http')
  assert.deepEqual(edits, { searchProvider: 'reset', fetchProvider: 'reset' })
  controller.providers = { search: [{ id: 'eduwork-search', title: 'EduWork' }], fetch: [{ id: 'http' }] }
  assert.ok(controller.options('search', 'eduwork-search').some(row => row.id === 'eduwork-search'))
  assert.equal(controller.options('search', 'removed-provider').find(row => row.id === 'removed-provider').missing, true)
})
