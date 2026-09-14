import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { activePresetRoot, assertLauncherPresetRoot, assertOptionalPresetRoster, syncOptionalPresets } from '../lib/preset-policy.js'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'chatecnu-preset-policy-'))
  const active = path.join(root, 'active')
  const library = path.join(root, 'library')
  await mkdir(active)
  for (const id of ['minimal', 'cordis']) {
    await mkdir(path.join(library, id), { recursive: true })
    await writeFile(path.join(library, id, 'agent.cordis.yml'), `- name: ${id}\n`)
  }
  return { root, active, library }
}

test('optional preset synchronization materializes and removes only policy entries', async t => {
  const { root, active, library } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const environment = { DSH_PRODUCT_PRESET_DIR: active, DSH_PRODUCT_PRESET_LIBRARY_DIR: library }

  await syncOptionalPresets({ enabledOptionalPresets: ['minimal', 'cordis'] }, environment)
  assert.match(await readFile(path.join(active, 'minimal', 'agent.cordis.yml'), 'utf8'), /minimal/)
  assert.match(await readFile(path.join(active, 'cordis', 'agent.cordis.yml'), 'utf8'), /cordis/)

  await syncOptionalPresets({ enabledOptionalPresets: ['cordis'] }, environment)
  await assert.rejects(readFile(path.join(active, 'minimal', 'agent.cordis.yml')), /ENOENT/)
  assert.match(await readFile(path.join(active, 'cordis', 'agent.cordis.yml'), 'utf8'), /cordis/)
})

test('optional preset synchronization fails loud when launcher roots are missing', async () => {
  await assert.rejects(syncOptionalPresets({ enabledOptionalPresets: [] }, {}), /roots are unavailable/)
})

test('optional preset synchronization uses and verifies the DSH roster root', async t => {
  const { root, active, library } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const roster = {
    roots: [{ path: active, trust: 'system' }],
    async list() {
      const rows = []
      for (const id of ['minimal', 'cordis']) {
        try {
          await readFile(path.join(active, id, 'agent.cordis.yml'))
          rows.push({ id })
        } catch {}
      }
      return rows
    },
  }
  const environment = { DSH_PRODUCT_PRESET_DIR: active, DSH_PRODUCT_PRESET_LIBRARY_DIR: library }

  assert.equal(activePresetRoot(roster), active)
  assert.equal(assertLauncherPresetRoot(roster, environment), active)
  await syncOptionalPresets({ enabledOptionalPresets: ['cordis'] }, environment, roster)
  await assertOptionalPresetRoster({ enabledOptionalPresets: ['cordis'] }, roster)
  await assert.rejects(
    syncOptionalPresets(
      { enabledOptionalPresets: ['minimal'] },
      { ...environment, DSH_PRODUCT_PRESET_DIR: path.join(root, 'wrong') },
      roster,
    ),
    /does not match the DSH roster root/,
  )
})
