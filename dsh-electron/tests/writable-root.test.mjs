import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  const result = prepareWritableRoot(options(product, root))
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
  prepareWritableRoot(options(product, root))
  await writeFile(join(root, 'config/eduwork.jsonc'), 'user-edited\n')
  const second = prepareWritableRoot(options(product, root))
  assert.equal(second.created, false)
  assert.equal(await readFile(join(root, 'config/eduwork.jsonc'), 'utf8'), 'user-edited\n')
})

test('initializes an existing empty root in place', async t => {
  const { product, root } = await fixture(t)
  await mkdir(root, { recursive: true })
  const result = prepareWritableRoot(options(product, root))
  assert.equal(result.created, true)
  assert.equal(await readFile(join(root, 'config/eduwork.jsonc'), 'utf8'), '{"packaged":true}\n')
})

test('refuses a non-empty root without a receipt and leaves it unchanged', async t => {
  const { product, root } = await fixture(t)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'keep.txt'), 'keep\n')
  assert.throws(() => prepareWritableRoot(options(product, root)), /缺少归属回执/)
  assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'keep\n')
  assert.equal(existsSync(join(root, 'config/eduwork.jsonc')), false)
})

test('rejects a receipt from another distribution or an invalid receipt', async t => {
  const { product, root } = await fixture(t)
  prepareWritableRoot(options(product, root))
  assert.throws(() => prepareWritableRoot(options(product, root, 'other')), /其他发行版/)
  await writeFile(join(root, '.eduwork-writable-root.json'), '{invalid\n')
  assert.throws(() => prepareWritableRoot(options(product, root)), /归属回执无效/)
})

test('fails cleanly when the packaged config template is missing', async t => {
  const { base, product, root } = await fixture(t, { template: false })
  assert.throws(() => prepareWritableRoot(options(product, root)), /缺少桌面配置模板/)
  assert.equal(existsSync(root), false)
  const parent = join(base, 'LocalAppData/EduWork')
  assert.equal(existsSync(parent) ? readdirSync(parent).length : 0, 0)
})
