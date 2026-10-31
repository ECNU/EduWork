import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireInstanceMutex, instanceIdentity, releaseInstanceMutex } from '../src/install-mutex.mjs'
import { prepareWritableRoot } from '../src/writable-root.mjs'

async function fixture(t, { template = true } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'eduwork-writable-root-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const product = join(base, 'program/resources/product')
  if (template) {
    await mkdir(join(product, 'resources/desktop/examples'), { recursive: true })
    await writeFile(join(product, 'resources/desktop/eduwork.jsonc'), '{"packaged":true}\n')
    await writeFile(join(product, 'resources/desktop/examples/readme.md'), 'example\n')
  } else {
    await mkdir(product, { recursive: true })
  }
  return { base, product, root: join(base, 'LocalAppData/EduWork/example') }
}

const options = (product, root, distribution = 'example') => ({ root, distribution, product, productVersion: '0.4.9', now: () => '2026-10-26T00:00:00.000Z' })

test('creates the writable root with config, examples and a receipt', async t => {
  const { product, root } = await fixture(t)
  const result = await prepareWritableRoot(options(product, root))
  assert.equal(result.created, true)
  assert.equal(await readFile(join(root, 'config/eduwork.jsonc'), 'utf8'), '{"packaged":true}\n')
  assert.equal(await readFile(join(root, 'config/examples/readme.md'), 'utf8'), 'example\n')
  assert.deepEqual(JSON.parse(await readFile(join(root, '.eduwork-writable-root.json'), 'utf8')), {
    schemaVersion: 1, layout: 'installed', distribution: 'example', productVersion: '0.4.9', createdAt: '2026-10-26T00:00:00.000Z',
  })
  assert.equal(existsSync(join(root, 'data')), true)
  assert.deepEqual(readdirSync(join(root, '..')), ['example'])
})

test('reuses an initialized root and never replaces the user config', async t => {
  const { product, root } = await fixture(t)
  await prepareWritableRoot(options(product, root))
  await writeFile(join(root, 'config/eduwork.jsonc'), 'user-edited\n')
  const second = await prepareWritableRoot(options(product, root))
  assert.equal(second.created, false)
  assert.equal(await readFile(join(root, 'config/eduwork.jsonc'), 'utf8'), 'user-edited\n')
})

test('initializes an existing empty root in place', async t => {
  const { product, root } = await fixture(t)
  await mkdir(root, { recursive: true })
  const result = await prepareWritableRoot(options(product, root))
  assert.equal(result.created, true)
  assert.equal(await readFile(join(root, 'config/eduwork.jsonc'), 'utf8'), '{"packaged":true}\n')
})

test('refuses a non-empty root without a receipt and leaves it unchanged', async t => {
  const { product, root } = await fixture(t)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'keep.txt'), 'keep\n')
  await assert.rejects(prepareWritableRoot(options(product, root)), /缺少归属回执/)
  assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'keep\n')
  assert.equal(existsSync(join(root, 'config/eduwork.jsonc')), false)
})

test('rejects a receipt from another distribution or an invalid receipt', async t => {
  const { product, root } = await fixture(t)
  await prepareWritableRoot(options(product, root))
  await assert.rejects(prepareWritableRoot(options(product, root, 'other')), /其他发行版/)
  await writeFile(join(root, '.eduwork-writable-root.json'), '{invalid\n')
  await assert.rejects(prepareWritableRoot(options(product, root)), /归属回执无效/)
})

test('fails cleanly when the packaged config template is missing', async t => {
  const { base, product, root } = await fixture(t, { template: false })
  await assert.rejects(prepareWritableRoot(options(product, root)), /缺少桌面配置模板/)
  assert.equal(existsSync(root), false)
  const parent = join(base, 'LocalAppData/EduWork')
  assert.equal(existsSync(parent) ? readdirSync(parent).length : 0, 0)
})

test('refuses while another process holds the writable root mutex', async t => {
  const { product, root } = await fixture(t)
  const mutex = await acquireInstanceMutex('writable', root, 'Another process is initializing the writable root')
  let released = false
  t.after(async () => { if (!released) await releaseInstanceMutex(mutex) })
  await assert.rejects(prepareWritableRoot(options(product, root)), /Another process is initializing the writable root/)
  assert.equal(existsSync(root), false)
  released = true
  await releaseInstanceMutex(mutex)
  const result = await prepareWritableRoot(options(product, root))
  assert.equal(result.created, true)
})

test('keeps the writable root identity stable across missing parent creation', { skip: process.platform !== 'win32' }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'eduwork-writable-identity-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const real = join(base, 'real')
  const alias = join(base, 'alias')
  await mkdir(real)
  await symlink(real, alias, 'junction')
  const target = join(alias, 'missing', 'W')
  const before = instanceIdentity(target)
  await mkdir(join(alias, 'missing'))
  const after = instanceIdentity(target)
  assert.equal(after, before)
})
