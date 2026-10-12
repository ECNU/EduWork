import test from 'node:test'
import assert from 'node:assert/strict'
import { isDsh020, rebuiltDshPeers, rebuiltDshPeerRange, qualifiedDesktopBaseline } from '../dsh-compatibility.mjs'

test('API family matching accepts subsequent candidates without accepting another minor or invalid versions', () => {
  for (const version of ['0.2.0-rc.1', '0.2.0-rc.3', '0.2.0', '0.2.1', '0.2.1-rc.1', '0.2.0+build.1']) assert.equal(isDsh020(version), true)
  for (const version of [undefined, 'bad', '0.2.0-rc.01', '0.2.0-beta.1', '0.1.7-rc.2', '0.3.0-alpha.1', '0.3.0', '9.0.0']) assert.equal(isDsh020(version), false)
})

test('only owned rebuilt plugins receive the native API range; other peers and source metadata remain intact', () => {
  const source = { name: '@eduwork/example', peerDependencies: { '@deepseek-ai/dsh': '0.1.5-rc.1', '@deepseek-ai/dsh-tools': '0.1.5-rc.1', '@deepseek-ai/cordis': '^4.0.2', '@deepseek-ai/dsh-other-toolkit': '0.1.5-rc.1', 'other': '^2.0.0' } }
  const before = structuredClone(source)
  for (const version of ['0.2.0-rc.2', '0.2.0-rc.3', '0.2.0', '0.2.1']) {
    const peers = rebuiltDshPeers(source, version)
    assert.equal(peers['@deepseek-ai/dsh'], rebuiltDshPeerRange)
    assert.equal(peers['@deepseek-ai/dsh-tools'], rebuiltDshPeerRange)
    assert.equal(peers['@deepseek-ai/cordis'], '^4.0.2')
    assert.equal(peers.other, '^2.0.0')
  }
  assert.deepEqual(source, before)
  assert.equal(rebuiltDshPeers(source, '0.1.5-rc.1')['@deepseek-ai/dsh'], '0.1.5-rc.1')
  for (const version of ['0.2.0-rc.1', '0.3.0-rc.1', '0.3.0', '9.0.0']) assert.throws(() => rebuiltDshPeers(source, version), /qualification/)
  assert.throws(() => rebuiltDshPeers({ ...source, name: '@third-party/example' }, '0.2.0-rc.2'), /distribution-owned/)
  assert.equal(rebuiltDshPeers({ ...source, name: '@ustc/tokenworks-bootstrap' }, '0.2.0-rc.2', { editionOwned: true })['@deepseek-ai/dsh'], rebuiltDshPeerRange)
  for (const name of ['@deepseek-ai/dsh-tools', 'unscoped', undefined]) assert.throws(() => rebuiltDshPeers({ ...source, name }, '0.2.0-rc.2', { editionOwned: true }), /distribution-owned/)
})

test('broader peer ranges do not qualify an unknown or mixed desktop kernel', () => {
  const identity = { dshVersion: '0.2.0-rc.2', dshCommit: '639ed015397290b3745d163aafe02ffee4aa3f84' }
  const baseline = qualifiedDesktopBaseline(identity)
  assert.equal(baseline.native, true)
  assert.equal(baseline.configurableSubagents, true)
  assert.equal(baseline.upstreamReveal, true)
  assert.equal(baseline.migrateSchedule, true)
  baseline.native = false
  assert.equal(qualifiedDesktopBaseline(identity).native, true)
  for (const invalid of [{ ...identity, dshCommit: 'wrong' }, { ...identity, dshVersion: '0.2.0-rc.3' }, {}, undefined, { dshVersion: '__proto__' }]) assert.equal(qualifiedDesktopBaseline(invalid), undefined)
})
