import assert from 'node:assert/strict'
import { extensions } from '../dsh-plugins/client-ui-extensions/lib/catalog.js'

export function productOptionalBundlePolicy(locks, extensionDefaults = {}) {
  const offered = new Set(locks.map(lock => lock.name))
  assert.ok(extensionDefaults && typeof extensionDefaults === 'object' && !Array.isArray(extensionDefaults), 'extensionDefaults must be a package-to-boolean map')
  for (const [name, enabled] of Object.entries(extensionDefaults)) {
    assert.ok(extensions.some(row => row.name === name) && offered.has(name), `Unknown or unpublished extension default: ${name}`)
    assert.equal(typeof enabled, 'boolean', `Extension default must be boolean: ${name}`)
  }
  const available = extensions.filter(row => offered.has(row.name))
  const enabled = row => extensionDefaults[row.name] ?? row.defaultEnabled
  return {
    // Decision stays bundled with its own Skill; retain its pre-existing
    // native activation preferences without exposing a new product switch.
    optionalBundles: ['@eduwork/dsh-decision', ...available.map(row => row.name)].filter(name => offered.has(name)),
    disabledByDefaultBundles: available.filter(row => !enabled(row)).map(row => row.name),
  }
}

// Distribution packaging policy only. Never write a runtime deny-list: the
// native plugin manager remains free to install these bundles in a user profile.
export function selectOptionalProductBundles({ locks, optionalBundles, disabledByDefaultBundles = [], excluded = [], dependencyLock }) {
  assert.ok(Array.isArray(disabledByDefaultBundles) && disabledByDefaultBundles.every(name => optionalBundles.includes(name)), 'Default-disabled bundles must be optional')
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
    disabledByDefaultBundles: disabledByDefaultBundles.filter(name => !omitted.has(name)),
    excludedOptionalBundles: [...excluded],
  }
}
