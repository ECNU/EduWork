import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { patchProfileBundleOrder } from '../patch-profile-bundle-order.mjs'
import { writeNativeProfile } from '../../dsh-host/native-profile.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('hot activation applies deployment defaults immediately, below personal preferences', { skip: !runtime }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-bundle-order-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const anchor = join(runtime, 'package.json'), require = createRequire(anchor)
  const name = '@deepseek-ai/dsh-app-boot', original = require.resolve(name)
  const modules = join(root, 'node_modules'), copy = join(modules, name), target = join(copy, 'lib/index.js')
  await mkdir(join(copy, 'lib'), { recursive: true })
  await writeFile(join(copy, 'package.json'), await readFile(join(runtime, 'node_modules', name, 'package.json')))
  await writeFile(target, await readFile(original))
  await patchProfileBundleOrder(modules)
  await assert.rejects(patchProfileBundleOrder(modules), /input changed/)
  // Resolve the copied module's imports against the same locked dependencies.
  const source = pathToFileURL(original).href, patched = pathToFileURL(await realpath(target)).href
  const hook = registerHooks({ resolve(specifier, context, next) {
    return next(specifier, context.parentURL === patched ? { ...context, parentURL: source } : context)
  } })
  let boot
  try { boot = await import(patched) } finally { hook.deregister() }
  const { PluginManager } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-manager')).href)
  const profile = join(root, 'profile'), extension = 'fixture-extension'
  const pkg = join(profile, 'node_modules', extension)
  await mkdir(pkg, { recursive: true })
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: extension, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(pkg, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'fixture', name: extension, config: { enabled: false } }] }]))
  const options = { profile, bundles: [extension], optionalBundles: [extension], patches: [{ id: 'fixture', config: { relay: 'deployment' } }] }
  await writeNativeProfile(options)
  const manager = Object.assign(Object.create(PluginManager.prototype), { profile: { dir: profile, installAnchor: anchor }, managementBundles: new Set() })
  const context = { dir: profile, installAnchor: anchor, patchPath: join(profile, 'cordis.patch.yml'), home: root, overlays: [] }
  const entry = () => boot.composeEntries([boot.readProfilePatches('dsh', context)]).find(row => row.id === 'fixture')
  assert.deepEqual(entry().config, { relay: 'deployment' })
  await manager.selectBundle(extension, false)
  assert.equal(entry(), undefined)
  await manager.selectBundle(extension, true)
  assert.deepEqual(entry().config, { relay: 'deployment' })
  await writeFile(context.patchPath, JSON.stringify([{ id: 'fixture', config: { relay: 'personal', enabled: true } }]))
  await manager.selectBundle(extension, false)
  await manager.selectBundle(extension, true)
  assert.deepEqual(entry().config, { relay: 'personal', enabled: true })
})

test('repair a remote preference saved while school defaults were unavailable', { skip: !runtime }, async t => {
  const profile = await mkdtemp(join(tmpdir(), 'eduwork-remote-preference-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const require = createRequire(join(runtime, 'package.json'))
  const yaml = require('yaml')
  const organization = { relay: 'https://relay.example.edu/', oidcProfileId: 'campus' }
  const remote = 'eduwork-remote-access', file = join(profile, 'cordis.patch.yml')
  const options = { profile, bundles: [], yaml, parse: yaml.parse, patches: [{ id: remote, config: { organization } }] }
  await writeNativeProfile(options)
  const personal = { enabled: true, useOrganization: false, relay: 'https://personal.example/', hostName: 'Lab' }
  const prefix = '# personal settings\n- id: agent-default-model\n  config: { model: my-model }\n'
  await writeFile(file, prefix + yaml.stringify([{ id: remote, config: personal }]))
  await writeNativeProfile(options)
  const recovered = await readFile(file, 'utf8')
  assert.match(recovered, /# personal settings/)
  assert.deepEqual(yaml.parse(recovered)[1].config, { ...personal, organization })
  await writeNativeProfile(options)
  assert.equal(await readFile(file, 'utf8'), recovered)
  const explicit = yaml.stringify([{ id: remote, config: { ...personal, organization: { relay: 'https://other.example/' } } }])
  await writeFile(file, explicit)
  await writeNativeProfile(options)
  assert.equal(await readFile(file, 'utf8'), explicit)
})
