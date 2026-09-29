import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyGenericFirstLaunch } from '../scripts/verify-generic-first-launch.mjs'

function fixture(stable) {
  return {
    identity: { distribution: 'eduwork', version: stable ? '0.4.0' : '0.4.0-dev.20260929.1', dshVersion: '0.2.0-rc.1', sourceRelease: stable, sourceAlpha: !stable, automaticUpdates: stable },
    config: { product: { name: 'EduWork' }, organizations: [], updates: stable ? { provider: 'github', repository: 'ECNU/EduWork', defaultPolicy: 'stable' } : { provider: 'disabled' } },
  }
}
for (const stable of [false, true]) test(`${stable ? 'stable' : 'Alpha'} first launch keeps the intended update policy and public configuration`, () => {
  const { identity, config } = fixture(stable)
  assert.equal(verifyGenericFirstLaunch(identity, config).passed, true)
  assert.throws(() => verifyGenericFirstLaunch(identity, { ...config, updates: fixture(!stable).config.updates }))
  assert.throws(() => verifyGenericFirstLaunch({ ...identity, automaticUpdates: !stable }, config))
  assert.throws(() => verifyGenericFirstLaunch({ ...identity, sourceRelease: !stable }, config))
  assert.throws(() => verifyGenericFirstLaunch(identity, { ...config, organizations: [{ id: 'synthetic-school' }] }))
  assert.throws(() => verifyGenericFirstLaunch(identity, { ...config, product: { name: 'Another edition' } }))
})
test('stable first launch rejects a wrong repository or inherited development default', () => {
  const { identity, config } = fixture(true)
  for (const changes of [{ repository: 'example/other' }, { defaultPolicy: 'development' }]) {
    assert.throws(() => verifyGenericFirstLaunch(identity, { ...config, updates: { ...config.updates, ...changes } }))
  }
})
