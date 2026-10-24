import test from 'node:test'
import assert from 'node:assert/strict'
import { selectOptionalProductBundles } from '../optional-product-bundles.mjs'

const options = () => ({
  locks: [{ name: '@example/annotation', version: '1.0.0' }, { name: '@example/remote', version: '1.0.0' }, { name: '@example/core', version: '1.0.0' }],
  optionalBundles: ['@example/annotation', '@example/remote'],
  dependencyLock: { packages: { '': { dependencies: { '@example/remote': '1.0.0' } }, 'node_modules/@example/remote': { dependencies: { shared: '1.0.0' } }, 'node_modules/shared': {} } },
})
test('public packaging retains all published bundles by default', () => {
  const input = options(), before = structuredClone(input), result = selectOptionalProductBundles(input)
  assert.deepEqual(result.locks, input.locks);assert.deepEqual(result.optionalBundles, input.optionalBundles)
  assert.deepEqual(result.excludedOptionalBundles, []);assert.deepEqual(input, before)
})
test('edition omission removes only the optional bundle and retains shared dependencies', () => {
  const input = { ...options(), excluded: ['@example/remote'] }, before = structuredClone(input)
  const result = selectOptionalProductBundles(input)
  assert.deepEqual(result.locks.map(x => x.name), ['@example/annotation', '@example/core'])
  assert.deepEqual(result.optionalBundles, ['@example/annotation']);assert.deepEqual(input, before)
})
test('rejects required, unknown, duplicate and malformed omissions before assembly', () => {
  for (const excluded of [['@example/core'], ['@example/missing'], ['@example/remote', '@example/remote'], '../outside', [null]]) {
    assert.throws(() => selectOptionalProductBundles({ ...options(), excluded }))
  }
})
test('rejects removing a dependency of any retained package, including nested dependencies', () => {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const input = options();input.excluded = ['@example/remote']
    input.dependencyLock.packages['node_modules/other/node_modules/child'] = { [field]: { '@example/remote': '*' } }
    assert.throws(() => selectOptionalProductBundles(input), /depends on excluded bundle/)
  }
})
