import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sourceInstaller, cleanInstaller, installFromDmg } from '../src/installer-cleanup.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'installer-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const appPath = join(root, 'Applications', 'Example.app'), mount = join(root, 'mounted')
  const source = join(mount, 'Example.app'), imagePath = join(root, 'Example.dmg')
  await mkdir(appPath, { recursive: true }); await mkdir(source, { recursive: true })
  await writeFile(imagePath, 'synthetic-image')
  const images = async () => [{ 'image-path': imagePath, 'system-entities': [{ 'mount-point': mount }] }]
  const identify = async () => 'same-signed-app'
  const calls = []
  const options = { appPath, images, identify, platform: 'darwin', wait: async () => {},
    app: { isPackaged: true, isInApplicationsFolder: () => true, getPath: () => root,
      releaseSingleInstanceLock: () => calls.push('release'), moveToApplicationsFolder: () => { calls.push('move'); return true }, quit: () => calls.push('quit') },
    shell: { trashItem: async path => calls.push(['trash', path]) },
    dialog: { showMessageBox: async () => calls.push('error') },
    eject: async path => calls.push(['eject', path]), warn: message => calls.push(['warning', message]) }
  return { ...options, options, calls, source, imagePath, mount, statePath: join(root, 'pending-source-dmg-cleanup.json') }
}

test('automatic installation records only its own source before moving; installed startup ejects then trashes without prompting', async t => {
  const f = await fixture(t)
  assert.equal(await sourceInstaller(f.appPath, await f.images(), f.identify), null)
  assert.equal(await installFromDmg(f.options), false)
  assert.deepEqual(f.calls, [], 'Manual installation does not discover or clean other images')
  assert.equal(await installFromDmg({ ...f.options, appPath: f.source, app: { ...f.app, isInApplicationsFolder: () => false,
    moveToApplicationsFolder: () => { f.calls.push('move'); return true } } }), true)
  assert.equal(JSON.parse(await readFile(f.statePath, 'utf8')).imagePath, f.imagePath)
  assert.deepEqual(f.calls, ['release', 'move'])
  f.calls.length = 0
  assert.equal(await installFromDmg(f.options), false)
  assert.deepEqual(f.calls, [['eject', f.mount], ['trash', f.imagePath]])
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
})

test('cancellation and failed installation preserve the image and remove the pending cleanup record', async t => {
  const f = await fixture(t)
  for (const fails of [false, true]) {
    f.calls.length = 0
    await installFromDmg({ ...f.options, appPath: f.source, app: { ...f.app, isInApplicationsFolder: () => false,
      moveToApplicationsFolder: () => { if (fails) throw Error('denied'); return false } } })
    assert.deepEqual(f.calls, fails ? ['release', 'error', 'quit'] : ['release', 'quit'])
    await assert.rejects(access(f.statePath), { code: 'ENOENT' })
    await access(f.imagePath)
  }
})

test('cleanup retries busy source process, retains pending cleanup on failure and retries even after volume was ejected', async t => {
  const f = await fixture(t), candidate = await sourceInstaller(f.source, await f.images(), f.identify)
  await writeFile(f.statePath, JSON.stringify(candidate))
  let attempts = 0
  await installFromDmg({ ...f.options, eject: async () => { attempts++; throw Error('busy') } })
  assert.equal(attempts, 25)
  assert.equal(f.calls[0][0], 'warning'); assert.equal(f.calls.length, 1)
  await access(f.statePath)
  f.calls.length = 0
  await installFromDmg({ ...f.options, images: async () => [] })
  assert.deepEqual(f.calls, [['trash', f.imagePath]])
  await writeFile(f.statePath, JSON.stringify(candidate)); f.calls.length = 0; attempts = 0
  await installFromDmg({ ...f.options, eject: async () => { if (++attempts < 3) throw Error('busy') } })
  assert.equal(attempts, 3); assert.deepEqual(f.calls, [['trash', f.imagePath]])
})

test('changed signature, malformed record, replaced image, and active source app never get trashed', async t => {
  const f = await fixture(t), candidate = await sourceInstaller(f.source, await f.images(), f.identify)
  const options = { ...f.options, trash: f.shell.trashItem }
  await assert.rejects(cleanInstaller(candidate, { ...options, identify: async () => 'other' }), /来源/)
  await assert.rejects(cleanInstaller({}, options), /来源/)
  await assert.rejects(cleanInstaller(candidate, { ...options, appPath: f.source }), /仍在使用/)
  assert.deepEqual(f.calls, [])
  await assert.rejects(cleanInstaller(candidate, { ...options, eject: async () => writeFile(f.imagePath, 'replacement') }), /已变化/)
  await assert.rejects(cleanInstaller(candidate, options), /已变化/)
  assert.deepEqual(f.calls, [])
})

test('Windows and unpackaged development runs skip installation and cleanup', async t => {
  const f = await fixture(t)
  for (const options of [{ ...f.options, platform: 'win32' }, { ...f.options, app: { ...f.app, isPackaged: false } }]) {
    assert.equal(await installFromDmg(options), false)
  }
  assert.deepEqual(f.calls, [])
})

test('cleanup resolves image aliases and retains a record if trash fails', async t => {
  const f = await fixture(t), candidate = await sourceInstaller(f.source, await f.images(), f.identify)
  const alias = f.imagePath + '.alias'; await symlink(f.imagePath, alias)
  await writeFile(f.statePath, JSON.stringify(candidate))
  await installFromDmg({ ...f.options, images: async () => [{ 'image-path': alias, 'system-entities': [{ 'mount-point': f.mount }] }],
    shell: { trashItem: async () => { throw Error('trash denied') } } })
  assert.deepEqual(f.calls[0], ['eject', f.mount]); assert.equal(f.calls[1][0], 'warning')
  await access(f.statePath); await access(f.imagePath)
  f.calls.length = 0
  await rm(f.imagePath)
  await installFromDmg(f.options)
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
  assert.deepEqual(f.calls, [])
})
