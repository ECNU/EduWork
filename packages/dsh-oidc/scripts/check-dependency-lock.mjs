import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
assert.equal(lock.lockfileVersion, 3)
assert.equal(lock.version, manifest.version)
assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies)
const baseline = '0.1.5-rc.1'
const required = Object.keys(manifest.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-'))
for (const name of required) {
  assert.equal(manifest.devDependencies[name], baseline, `${name}: development baseline must be exact`)
  assert.equal(lock.packages[`node_modules/${name}`]?.version, baseline, `${name}: lock must match the development baseline`)
}
for (const [name, version] of [['@deepseek-ai/cordis', '4.0.2'], ['@earendil-works/pi-ai', '0.85.1']]) {
  assert.equal(manifest.devDependencies[name], version)
  assert.equal(lock.packages[`node_modules/${name}`]?.version, version)
}
const dsh = Object.entries(lock.packages).filter(([path]) => /(?:^|\/)node_modules\/@deepseek-ai\/dsh-[^/]+$/.test(path))
for (const [path, entry] of dsh) {
  assert.equal(entry.version, baseline, `${path}: mixed DSH lock closure`)
  assert.ok(entry.resolved?.startsWith('https://registry.npmjs.org/'), `${path}: must resolve from the public registry`)
  assert.ok(entry.integrity?.startsWith('sha512-'), `${path}: missing integrity`)
  assert.notEqual(entry.link, true, `${path}: machine-local dependency link`)
}
console.log(`Development lock pins ${dsh.length} DSH packages to ${baseline}; registry URLs and integrity are recorded.`)
