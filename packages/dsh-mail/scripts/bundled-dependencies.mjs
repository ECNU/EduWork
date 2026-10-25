// Inventory the modules that actually reached the JS output, including nested
// copies. These build dependencies are invisible to a consumer's npm audit.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const root = fileURLToPath(new URL('../', import.meta.url))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const posix = path => path.split(sep).join('/')
export const inventoryPath = 'lib/bundled-dependencies.json'

export async function collectInventory(directory = root) {
  const manifest = await json(resolve(directory, 'package.json'))
  const lock = await json(resolve(directory, 'package-lock.json'))
  const outputs = [], dependencies = new Map()
  for (const file of (await readdir(resolve(directory, 'lib'))).filter(name => name.endsWith('.js')).sort()) {
    const path = resolve(directory, 'lib', file)
    const map = await json(path + '.map')
    assert.ok(Array.isArray(map.sources) && map.sources.length, `Missing module sources for ${file}`)
    outputs.push({ path: `lib/${file}`, sha256: hash(await readFile(path)) })
    for (const source of map.sources) {
      if (!source.replaceAll('\\', '/').includes('node_modules/')) continue
      const modulePath = resolve(dirname(path), map.sourceRoot ?? '', source)
      const local = posix(relative(directory, modulePath))
      assert.ok(local.startsWith('node_modules/') && !local.split('/').includes('..'), `Dependency outside package build root: ${source}`)
      const matches = [...local.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g)]
      const last = matches.at(-1)
      assert.ok(last, `Unknown bundled dependency ${source}`)
      const packagePath = local.slice(0, last.index + last[0].length)
      if (dependencies.has(packagePath)) continue
      const installed = await json(resolve(directory, packagePath, 'package.json'))
      const pinned = lock.packages[packagePath]
      assert.ok(pinned?.integrity && pinned?.version, `Unpinned bundled dependency ${packagePath}`)
      assert.equal(installed.name, last[1], `Package name mismatch: ${packagePath}`)
      assert.equal(installed.version, pinned.version, `Installed package differs from lock: ${packagePath}`)
      dependencies.set(packagePath, { path: packagePath, name: installed.name, version: installed.version, integrity: pinned.integrity, license: pinned.license })
    }
  }
  assert.ok(outputs.some(file => file.path === 'lib/index.js') && outputs.some(file => file.path === 'lib/client.js'), 'Both plugin entries must be built')
  const result = { schemaVersion: 1, package: { name: manifest.name, version: manifest.version }, outputs, dependencies: [...dependencies.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')) }
  validateSecurityBaseline(result)
  return result
}

export function validateSecurityBaseline(inventory) {
  assert.equal(inventory.schemaVersion, 1)
  for (const name of ['imapflow', 'mailparser', 'nodemailer']) assert.ok(inventory.dependencies.some(row => row.name === name), `Missing bundled ${name}`)
  for (const row of inventory.dependencies) {
    assert.ok(semver.valid(row.version), `Invalid dependency version: ${row.name}`)
    // All nested Nodemailer copies must include the latest address-parser fixes.
    if (row.name === 'nodemailer') assert.ok(semver.gte(row.version, '10.1.4'), `Vulnerable bundled Nodemailer: ${row.path}@${row.version}`)
    if (row.name === 'mailparser') assert.ok(semver.gte(row.version, '3.12.4'), `Mailparser is below the reviewed security baseline: ${row.version}`)
  }
}

export function affectedAdvisories(dependencies, response) {
  assert.ok(response && typeof response === 'object' && !Array.isArray(response), 'Invalid advisory response')
  const found = []
  for (const [name, advisories] of Object.entries(response)) {
    const installed = dependencies.filter(row => row.name === name)
    assert.ok(installed.length && Array.isArray(advisories), `Invalid advisory package: ${name}`)
    for (const advisory of advisories) {
      assert.ok(['low', 'moderate', 'high', 'critical'].includes(advisory.severity) && semver.validRange(advisory.vulnerable_versions), `Invalid advisory for ${name}`)
      const versions = [...new Set(installed.filter(row => semver.satisfies(row.version, advisory.vulnerable_versions, { includePrerelease: true })).map(row => row.version))]
      if (versions.length) found.push({ name, versions, severity: advisory.severity, title: advisory.title, url: advisory.url })
    }
  }
  return found
}

export async function auditInventory(inventory, fetcher = fetch) {
  validateSecurityBaseline(inventory)
  const versions = {}
  for (const row of inventory.dependencies) versions[row.name] = [...new Set([...(versions[row.name] ?? []), row.version])]
  // Same public bulk endpoint as npm audit; submit only names and versions.
  const response = await fetcher('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(versions), signal: AbortSignal.timeout(30_000),
  })
  assert.ok(response.ok, `Bundled-dependency advisory check failed: HTTP ${response.status}`)
  const advisories = affectedAdvisories(inventory.dependencies, await response.json())
  const blocking = advisories.filter(row => ['high', 'critical'].includes(row.severity))
  assert.equal(blocking.length, 0, 'High/critical vulnerabilities in shipped code: ' + JSON.stringify(blocking))
  return { packages: inventory.dependencies.length, advisories, highOrCritical: 0 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generated = await collectInventory()
  if (process.argv[2] === 'write') {
    await writeFile(resolve(root, inventoryPath), JSON.stringify(generated, null, 2) + '\n')
    console.log(`Recorded ${generated.dependencies.length} bundled dependencies across ${generated.outputs.length} JS files`)
  } else {
    const recorded = await json(resolve(root, inventoryPath))
    assert.deepEqual(recorded, generated, 'Bundle inventory is stale or does not match the built JS and locked dependencies')
    if (process.argv[2] === 'audit') console.log(JSON.stringify(await auditInventory(recorded), null, 2))
    else assert.equal(process.argv[2], 'verify', 'Use write, verify, or audit')
  }
}
