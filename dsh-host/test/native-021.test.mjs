import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeNativeProfile } from '../native-profile.mjs'
import { qualifiedDesktopBaseline } from '../dsh-compatibility.mjs'
import { pinnedDshContract, verifyPinnedDshReceipt } from '../../scripts/pinned-dsh-contract.mjs'
import { adaptNativeHostEntry } from '../prepare-native.mjs'

const upstream = process.env.EDUWORK_TEST_UPSTREAM
const hostEntry = 'apps/desktop-host/src/index.ts'
// Reviewed: this upstream entry binds 127.0.0.1 with an ephemeral port. An
// earlier upstream change once went back to a fixed --port 19387.
const reviewedHostEntry = '1f61890c63da8898cef678479450d7647163530c416751d161dde6b397c654d3'

test('selected Runtime remains bound to both its version and source commit', () => {
  const receipt = { dshVersion: '0.2.1-rc.3', dshCommit: '1f81c047fc48fa190a683e469daa699857e9afe8' }
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

test('the pinned Host entry is the reviewed loopback, ephemeral-port revision', async () => {
  const inputs = JSON.parse(await readFile(new URL('../upstream-inputs-pinned-source.json', import.meta.url), 'utf8'))
  assert.equal(inputs[hostEntry], reviewedHostEntry, 'recheck the Host listen address and port before updating this hash')
})

test('the adapted Host entry listens only on 127.0.0.1 with port 0', { skip: !upstream }, async () => {
  const adapted = adaptNativeHostEntry(await readFile(join(upstream, hostEntry), 'utf8'))
  const args = adapted.match(/args: (\[[^\]]*'--port'[^\]]*\])/)?.[1]
  assert.deepEqual(JSON.parse(args.replaceAll("'", '"')), ['--no-open', '--host', '127.0.0.1', '--port', '0'])
  assert.doesNotMatch(adapted, /19387|0\.0\.0\.0|'::'/)
})
