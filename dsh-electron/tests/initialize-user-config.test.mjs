import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeUserConfig } from '../src/initialize-user-config.mjs'

test('first launch copies the bundled user config and examples', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-config-init-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'product')
  const source = join(product, 'resources/desktop')
  await mkdir(join(source, 'examples'), { recursive: true })
  await writeFile(join(source, 'eduwork.jsonc'), 'default config')
  await writeFile(join(source, 'examples/organization.jsonc'), 'default example')
  const config = join(root, 'user/config/eduwork.jsonc')
  await initializeUserConfig({ product, config })
  assert.equal(await readFile(config, 'utf8'), 'default config')
  assert.equal(await readFile(join(root, 'user/config/examples/organization.jsonc'), 'utf8'), 'default example')
})

test('upgrades preserve existing config and examples while adding missing examples', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-config-upgrade-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'product')
  const source = join(product, 'resources/desktop')
  const config = join(root, 'user/config/eduwork.jsonc')
  await mkdir(join(source, 'examples'), { recursive: true })
  await mkdir(join(root, 'user/config/examples'), { recursive: true })
  await writeFile(join(source, 'eduwork.jsonc'), 'new default')
  await writeFile(join(source, 'examples/organization.jsonc'), 'new default example')
  await writeFile(join(source, 'examples/updates.jsonc'), 'new example')
  await writeFile(config, 'user config')
  await writeFile(join(root, 'user/config/examples/organization.jsonc'), 'user example')
  await initializeUserConfig({ product, config })
  assert.equal(await readFile(config, 'utf8'), 'user config')
  assert.equal(await readFile(join(root, 'user/config/examples/organization.jsonc'), 'utf8'), 'user example')
  assert.equal(await readFile(join(root, 'user/config/examples/updates.jsonc'), 'utf8'), 'new example')
})
