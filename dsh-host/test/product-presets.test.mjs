import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareProductPresets } from '../product-presets.mjs'
import { syncOptionalPresets } from '../../dsh-plugins/brand-settings-native/lib/preset-policy.js'

test('a separate home starts minimal/creative off, saved choices survive restart, user presets survive updates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-presets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'product'), home = join(root, 'home'), other = join(root, 'other')
  for (const name of ['standard', 'ptc', 'minimal', 'cordis']) {
    await mkdir(join(product, 'd/presets', name), { recursive: true })
    await writeFile(join(product, 'd/presets', name, 'agent.cordis.yml'), '[]')
  }
  await mkdir(join(home, '.agent-presets/mine'), { recursive: true })
  await writeFile(join(home, '.agent-presets/mine/agent.cordis.yml'), '# user authored')
  let environment = await prepareProductPresets({ product, home })
  assert.deepEqual((await readdir(environment.DSH_PRODUCT_PRESET_DIR)).sort(), ['ptc', 'standard'])
  await syncOptionalPresets({ enabledOptionalPresets: ['cordis'] }, environment)
  environment = await prepareProductPresets({ product, home })
  await syncOptionalPresets({ enabledOptionalPresets: ['cordis'] }, environment)
  assert.ok((await readdir(environment.DSH_PRODUCT_PRESET_DIR)).includes('cordis'))
  const otherEnvironment = await prepareProductPresets({ product, home: other })
  assert.deepEqual((await readdir(otherEnvironment.DSH_PRODUCT_PRESET_DIR)).sort(), ['ptc', 'standard'])
  assert.equal(await readFile(join(home, '.agent-presets/mine/agent.cordis.yml'), 'utf8'), '# user authored')
  assert.equal((await readdir(join(product, 'd/presets'))).length, 4)
})
