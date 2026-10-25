import assert from 'node:assert/strict'

// Distribution packaging policy only. Never write a runtime deny-list: the
// native plugin manager remains free to install these bundles in a user profile.
export function selectOptionalProductBundles({ locks, optionalBundles, excluded = [], dependencyLock }) {
  assert.ok(Array.isArray(excluded) && excluded.every(name => typeof name === 'string'), 'excludedOptionalBundles must be an array of package names')
  assert.equal(new Set(excluded).size, excluded.length, 'Duplicate excluded optional bundle')
  for (const name of excluded) {
    assert.ok(optionalBundles.includes(name), `Only optional product bundles may be excluded: ${name}`)
    assert.equal(locks.filter(lock => lock.name === name).length, 1, `Missing unique published bundle lock: ${name}`)
  }
  const omitted = new Set(excluded)
  for (const [path, manifest] of Object.entries(dependencyLock.packages)) {
    if (!path || excluded.some(name => path === `node_modules/${name}` || path.startsWith(`node_modules/${name}/`))) continue
    const requiredPeers = Object.keys(manifest.peerDependencies ?? {}).filter(name => !manifest.peerDependenciesMeta?.[name]?.optional)
    for (const name of [...Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }), ...requiredPeers]) {
      assert.ok(!omitted.has(name), `Retained package ${path} depends on excluded bundle ${name}`)
    }
  }
  return {
    locks: locks.filter(lock => !omitted.has(lock.name)),
    optionalBundles: optionalBundles.filter(name => !omitted.has(name)),
    excludedOptionalBundles: [...excluded],
  }
}
