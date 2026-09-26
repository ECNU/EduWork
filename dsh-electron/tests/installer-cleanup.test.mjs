import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findInstaller, cleanInstaller, offerInstallerCleanup } from '../src/installer-cleanup.mjs'

test('installer cleanup selects only one matching image and never trashes on failed ejection or changed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'installer-test-'))
  try {
    const appPath = join(root, 'Applications', 'Example.app')
    const mount = join(root, 'mounted')
    const imagePath = join(root, 'Example.dmg')
    await mkdir(appPath, { recursive: true })
    await mkdir(join(mount, 'Example.app'), { recursive: true })
    await writeFile(imagePath, 'synthetic-image')
    const images = [{ 'image-path': imagePath, 'system-entities': [{ 'mount-point': mount }] }]
    const identify = async () => 'same-signed-app'
    const candidate = await findInstaller(appPath, images, identify)
    assert.ok(candidate)
    assert.equal(await findInstaller(appPath, [...images, ...images], identify), null, 'Ambiguous images are ignored')
    assert.equal(await findInstaller(join(mount, 'Example.app'), images, identify), null, 'Never eject the running app')
    assert.equal(await findInstaller(appPath, images, async path => path.includes('Applications') ? 'installed' : 'other'), null)
    await mkdir(join(mount, 'Other.app'))
    assert.equal(await findInstaller(appPath, images, identify), null, 'Shared app images are ignored')
    await rm(join(mount, 'Other.app'), { recursive: true })
    const calls = []
    const dependencies = { appPath, images: async () => images, identify,
      eject: async path => calls.push(['eject', path]), trash: async path => calls.push(['trash', path]) }
    await cleanInstaller(candidate, dependencies)
    assert.deepEqual(calls, [['eject', candidate.mount], ['trash', candidate.imagePath]])
    calls.length = 0
    await assert.rejects(cleanInstaller(candidate, { ...dependencies, eject: async () => { throw new Error('busy') } }), /busy/)
    assert.deepEqual(calls, [], 'Busy image is not forced out or trashed')
    await writeFile(imagePath, 'replaced-image-with-different-size')
    await assert.rejects(cleanInstaller(candidate, dependencies), /已变化/)
    assert.deepEqual(calls, [], 'Changed candidate is not ejected')
    const changed = await findInstaller(appPath, images, identify)
    await assert.rejects(cleanInstaller(changed, { ...dependencies, eject: async () => { await writeFile(imagePath, 'changed-after-eject') } }), /已变化/)
    assert.deepEqual(calls, [], 'Image changed during ejection is not trashed')

    let answer = 1
    const statePath = join(root, 'installer-cleanup.json')
    const options = { ...dependencies, platform: 'darwin',
      app: { isPackaged: true, isInApplicationsFolder: () => true, getPath: () => root },
      window: { isDestroyed: () => false }, shell: { trashItem: dependencies.trash },
      dialog: { showMessageBox: async () => { calls.push(['dialog']); return { response: answer } } } }
    await offerInstallerCleanup({ ...options, platform: 'win32' })
    await offerInstallerCleanup({ ...options, app: { ...options.app, isInApplicationsFolder: () => false } })
    assert.deepEqual(calls, [], 'No installation prompt on Windows or outside Applications')
    await offerInstallerCleanup(options)
    assert.deepEqual(calls, [['dialog']], 'Keep does not eject or trash')
    calls.length = 0
    await offerInstallerCleanup(options)
    assert.deepEqual(calls, [], 'Keep is remembered for this signature')
    await rm(statePath)
    answer = 0
    await offerInstallerCleanup(options)
    assert.deepEqual(calls, [['dialog'], ['eject', candidate.mount], ['trash', candidate.imagePath]])
    calls.length = 0
    await offerInstallerCleanup(options)
    assert.deepEqual(calls, [], 'Successful cleanup is remembered')
    await rm(statePath)
    await offerInstallerCleanup({ ...options, eject: async () => { throw new Error('busy') } })
    assert.deepEqual(calls, [['dialog'], ['dialog']], 'Eject failure shows warning without trashing')
  } finally { await rm(root, { recursive: true, force: true }) }
})
