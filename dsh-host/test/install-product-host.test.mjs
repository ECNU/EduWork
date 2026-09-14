import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import test from 'node:test'
import { installProductHost } from '../install-product-host.mjs'

test('desktop preparation and Host installation agree on pinned DSH peers without relaxing code checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-host-projection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'product'), adapter = join(root, 'adapter')
  const identity = { dshVersion: '0.1.5-rc.1', dshCommit: 'fixture-upstream' }
  await mkdir(product); await mkdir(join(adapter, 'desktop-host/lib'), { recursive: true })
  await writeFile(join(product, 'assembly.json'), JSON.stringify(identity))
  const hostCode = 'export const fixture = true\n'
  await writeFile(join(adapter, 'desktop-host/lib/index.js'), hostCode)
  await writeFile(join(adapter, 'receipt.json'), JSON.stringify({ upstreamVersion: identity.dshVersion,
    upstreamCommit: identity.dshCommit, protocolVersion: 3,
    outputs: { 'desktop-host/lib/index.js': createHash('sha256').update(hostCode).digest('hex') } }))
  // Emulate the manifest emitted by prepare-desktop-product.ps1, which runs first.
  const source = resolve(import.meta.dirname, '../../dsh-plugins/credentials-native')
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  for (const name of Object.keys(manifest.peerDependencies)) if (name.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[name] = identity.dshVersion
  const plugin = join(product, 'd/node_modules', manifest.name)
  await mkdir(plugin, { recursive: true })
  await writeFile(join(plugin, 'package.json'), JSON.stringify(manifest, null, 2).replaceAll('\n', '\r\n') + '\r\n')
  await installProductHost({ product, adapter })
  await installProductHost({ product, adapter })
  const installed = JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8'))
  assert.equal(installed.peerDependencies['@deepseek-ai/dsh-credentials'], identity.dshVersion)
  assert.equal(installed.peerDependencies['@deepseek-ai/cordis'], manifest.peerDependencies['@deepseek-ai/cordis'])
  await writeFile(join(plugin, 'package.json'), JSON.stringify({ ...manifest, main: 'lib/other.js' }))
  await assert.rejects(installProductHost({ product, adapter }), /another native adapter.*package\.json/)
  await writeFile(join(plugin, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(plugin, 'lib/index.js'), 'export const altered = true\n')
  await assert.rejects(installProductHost({ product, adapter }), /another native adapter.*lib\/index\.js/)
})
