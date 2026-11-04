import test from 'node:test'
import assert from 'node:assert/strict'
import { ExtensionsController } from '../../dsh-plugins/client-ui-extensions/src/controller.js'
import { productOptionalBundlePolicy, selectOptionalProductBundles } from '../optional-product-bundles.mjs'
const name = '@eduwork/dsh-external-agents'
const bundle = (enabled = false) => ({ name, enabled, availability: 'installation', installed: false, version: '0.1.0' })
const ok = value => ({ ok: true, value })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('only a locked, retained optional package gets an opt-in policy', () => {
  assert.deepEqual(productOptionalBundlePolicy([{ name: '@eduwork/dsh-annotation' }]), { optionalBundles: ['@eduwork/dsh-annotation'], disabledByDefaultBundles: [] })
  const locks = [{ name }], policy = productOptionalBundlePolicy(locks)
  assert.deepEqual(policy, { optionalBundles: [name], disabledByDefaultBundles: [name] })
  const selected = selectOptionalProductBundles({ locks, ...policy, excluded: [name], dependencyLock: { packages: {} } })
  assert.deepEqual(selected.disabledByDefaultBundles, [])
})
test('lists available custom installation bundles; absent packages and unrelated packages stay out', async () => {
  const controller = new ExtensionsController({ listBundles: async () => ok([bundle(), { name: 'unrelated', availability: 'profile' }]) })
  await controller.refresh()
  assert.equal(controller.state.rows.length, 1)
  assert.equal(controller.state.rows[0].enabled, false)
  controller.manager.listBundles = async () => ok([{ ...bundle(), availability: 'missing' }])
  await controller.refresh(); assert.deepEqual(controller.state.rows, [])
})
test('a newer native state wins over a delayed response and disposed views cannot update', async () => {
  const first = deferred(), controller = new ExtensionsController({ listBundles: () => first.promise })
  const old = controller.refresh()
  controller.manager.listBundles = async () => ok([bundle(true)])
  await controller.refresh(); first.resolve(ok([bundle(false)])); await old
  assert.equal(controller.state.rows[0].enabled, true)
  const last = deferred(); controller.manager.listBundles = () => last.promise
  const pending = controller.refresh(); controller.dispose(); const before = controller.state
  last.resolve(ok([])); await pending; assert.equal(controller.state, before)
})
test('enable uses the official lifecycle once and shows a required restart without pretending it ran', async () => {
  const change = deferred(); let enabled = false, calls = 0
  const controller = new ExtensionsController({ listBundles: async () => ok([bundle(enabled)]), setBundleEnabled: async (pkg, value) => { assert.equal(pkg, name); calls++; enabled = value; return change.promise } })
  await controller.refresh()
  const pending = controller.setEnabled(name, true)
  assert.equal(controller.state.rows[0].enabled, false)
  await controller.setEnabled(name, true); assert.equal(calls, 1)
  change.resolve(ok({ application: 'restart-required' })); await pending
  assert.equal(controller.state.rows[0].enabled, true)
  assert.equal(controller.state.notice, 'restartRequired')
  assert.equal(controller.state.busy, false)
})
test('a lost response after persistence is read back instead of silently reverted', async () => {
  let enabled = false
  const controller = new ExtensionsController({ listBundles: async () => ok([bundle(enabled)]), setBundleEnabled: async () => { enabled = true; throw Error('disconnected') } })
  await controller.refresh(); await controller.setEnabled(name, true)
  assert.equal(controller.state.rows[0].enabled, true)
  assert.equal(controller.state.error, 'changeFailed')
})
test('native lifecycle failures remain failures even when the selection was saved', async () => {
  const controller = new ExtensionsController({ listBundles: async () => ok([bundle(true)]), setBundleEnabled: async () => ok({ application: 'failed', changed: true, error: { code: 'operation-error' } }) })
  await controller.refresh(); await controller.setEnabled(name, true)
  assert.equal(controller.state.error, 'changeFailed')
  assert.equal(controller.state.notice, '')
  controller.manager.setBundleEnabled = async () => ok({ application: 'applied' })
  await controller.setEnabled(name, true)
  assert.equal(controller.state.error, '')
  assert.equal(controller.state.notice, '')
})
test('read errors and deployment protection do not dispatch mutations', async () => {
  let called = false
  const controller = new ExtensionsController({ listBundles: async () => ok([{ ...bundle(), readOnlyReason: 'management-required' }]), setBundleEnabled: async () => { called = true } })
  await controller.refresh(); await controller.setEnabled(name, true); await controller.setEnabled('unknown', true)
  assert.equal(called, false)
  controller.manager.listBundles = async () => ({ ok: false })
  await controller.refresh(); assert.equal(controller.state.error, 'loadFailed')
})
