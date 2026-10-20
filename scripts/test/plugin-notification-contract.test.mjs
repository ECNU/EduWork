import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyPluginNotificationConsumers, withPluginNotifications } from '../plugin-notification-contract.mjs'

test('current product selects protocol service without changing the archived Web combination', async () => {
  const legacy = JSON.parse(await readFile(new URL('../../config/distributions/generic.json', import.meta.url), 'utf8'))
  const original = structuredClone(legacy)
  const current = withPluginNotifications(legacy)
  assert.deepEqual(legacy, original)
  assert.equal(legacy.plugins.some(row => row.name === '@eduwork/notifications'), false)
  assert.deepEqual(current.plugins[0], {
    root: 'core', source: 'dsh-plugins/notifications',
    id: 'eduwork-plugin-notifications', name: '@eduwork/notifications',
  })
  assert.deepEqual(current.plugins.slice(1), legacy.plugins)
  assert.throws(() => withPluginNotifications(current), /exactly once/)
})

test('assembly rejects old npm consumers instead of silently dropping plugin notifications', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-notification-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifests = ['@eduwork/dsh-knowledge-studio', '@eduwork/dsh-desktop-pet']
  for (const name of manifests) {
    await mkdir(join(root, name), { recursive: true })
    await writeFile(join(root, name, 'package.json'), JSON.stringify({ name, version: '0.0.0-test' }))
  }
  await assert.rejects(verifyPluginNotificationConsumers(root), /knowledge-studio.*does not support/)
  await verifyPluginNotificationConsumers(root, ['@eduwork/dsh-calendar'])
  for (const name of manifests)
    await writeFile(join(root, name, 'package.json'), JSON.stringify({ name, version: '0.0.0-test', eduworkNotificationProtocol: 1 }))
  await verifyPluginNotificationConsumers(root)
})
