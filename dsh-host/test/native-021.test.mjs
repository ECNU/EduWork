import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeNativeProfile } from '../native-profile.mjs'
import { qualifiedDesktopBaseline } from '../dsh-compatibility.mjs'
import { pinnedDshContract, verifyPinnedDshReceipt } from '../../scripts/pinned-dsh-contract.mjs'

test('selected Runtime remains bound to both its version and source commit', () => {
  const receipt = { dshVersion: '0.2.1-rc.2', dshCommit: '687f282e8625c6b8d11ff58211a90524be2e4317' }
  verifyPinnedDshReceipt(receipt)
  assert.equal(pinnedDshContract.packageVersion, receipt.dshVersion)
  assert.equal(qualifiedDesktopBaseline(receipt).builtinSchedule, true)
  assert.throws(() => verifyPinnedDshReceipt({ ...receipt, dshCommit: '639ed015397290b3745d163aafe02ffee4aa3f84' }))
  assert.throws(() => verifyPinnedDshReceipt({ ...receipt, dshVersion: '0.2.1-rc.1' }))
})

test('upgrade retires the Schedule bundle while preserving preferences, tasks and other bundles', async t => {
  const home = await mkdtemp(join(tmpdir(), 'eduwork-schedule-021-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const profile = join(home, 'profiles', 'desktop')
  await mkdir(profile, { recursive: true })
  const oldBundle = '@deepseek-ai/dsh-experimental-schedule-bundle'
  const manifest = { private: true, dependencies: { [oldBundle]: '0.2.0-rc.2', '@example/calendar': '1.0.0' },
    dsh: { profile: { bundles: [oldBundle, '@example/calendar'] } }, eduwork: { scheduleBundleMigrated: true } }
  const preferences = JSON.stringify([{ id: 'schedule', disabled: true, config: { custom: 'preserve' } }, { id: 'ui-schedule', disabled: false }])
  const tasks = JSON.stringify({ items: [{ id: 'synthetic-task', sessionId: 'synthetic-session', status: 'active' }] })
  await writeFile(join(profile, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(profile, 'cordis.patch.yml'), preferences)
  await writeFile(join(home, 'schedule.json'), tasks)
  const options = { profile, home, bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patches: [], builtinSchedule: true }
  await writeNativeProfile(options)
  const first = await readFile(join(profile, 'package.json'), 'utf8')
  const after = JSON.parse(first)
  assert.equal(after.dsh.profile.bundles.includes(oldBundle), false)
  assert.equal(after.dependencies[oldBundle], undefined)
  assert.equal(after.dependencies['@example/calendar'], '1.0.0')
  assert.ok(after.dsh.profile.bundles.includes('@example/calendar'))
  assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), preferences)
  assert.equal(await readFile(join(home, 'schedule.json'), 'utf8'), tasks)
  await writeNativeProfile(options)
  assert.equal(await readFile(join(profile, 'package.json'), 'utf8'), first)
})
