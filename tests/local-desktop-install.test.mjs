import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopApplicationName, installPreparedApplication } from '../scripts/lib/local-install.mjs'

test('local installation uses the packaged Alpha or stable application name for each edition', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-local-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const edition of ['EduWork', 'EduWork-ECNU']) {
    for (const [platform, sourceAlpha, expected] of [
      ['darwin', true, `${edition} Alpha.app`], ['darwin', false, `${edition}.app`], ['win32', true, edition],
    ]) {
      const applicationName = desktopApplicationName({ edition, platform, sourceAlpha })
      assert.equal(applicationName, expected)
      const staging = join(root, `${platform}-${sourceAlpha}-${edition}`)
      const installRoot = join(root, `installed-${platform}-${sourceAlpha}-${edition}`)
      await mkdir(join(staging, applicationName), { recursive: true })
      await mkdir(installRoot)
      await writeFile(join(staging, applicationName, 'payload'), 'accepted archive')
      const target = await installPreparedApplication({ staging, installRoot, applicationName })
      assert.equal(await readFile(join(target, 'payload'), 'utf8'), 'accepted archive')
    }
  }
})

test('local installation preserves an existing application and rejects a missing archive root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-local-existing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const applicationName = 'EduWork Alpha.app', staging = join(root, 'staging'), installRoot = join(root, 'installed')
  await mkdir(join(staging, applicationName), { recursive: true })
  await mkdir(join(installRoot, applicationName), { recursive: true })
  await writeFile(join(installRoot, applicationName, 'payload'), 'existing')
  await assert.rejects(() => installPreparedApplication({ staging, installRoot, applicationName }), /never replaced/)
  assert.equal(await readFile(join(installRoot, applicationName, 'payload'), 'utf8'), 'existing')
  await rm(join(staging, applicationName), { recursive: true })
  await assert.rejects(() => installPreparedApplication({ staging, installRoot, applicationName }), /application is missing/)
})
