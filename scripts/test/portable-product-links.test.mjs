import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rename, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyProductTree, assertContainedProductLinks } from '../portable-product-links.mjs'

test('copied npm executable links still work after relocating the product', async t => {
  const root = await mkdtemp(join(tmpdir(), 'product-links-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(join(source, 'node_modules/.bin'), { recursive: true })
  await mkdir(join(source, 'node_modules/tool'))
  await writeFile(join(source, 'node_modules/tool/cli.js'), 'portable executable')
  await symlink('../tool/cli.js', join(source, 'node_modules/.bin/tool'), 'file')
  await copyProductTree(source, join(root, 'copy'))
  await rename(join(root, 'copy'), join(root, 'relocated'))
  assert.equal(await readFile(join(root, 'relocated/node_modules/.bin/tool'), 'utf8'), 'portable executable')
  assert.deepEqual(await assertContainedProductLinks(join(root, 'relocated')), { containedLinks: 1 })
})

test('external and absolute links fail before packaging', async t => {
  const root = await mkdtemp(join(tmpdir(), 'product-link-boundary-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'product');await mkdir(product)
  await writeFile(join(root, 'external'), 'outside')
  await symlink('../external', join(product, 'escape'), 'file')
  await assert.rejects(assertContainedProductLinks(product), /escapes/)
  await rm(join(product, 'escape'))
  await writeFile(join(product, 'internal'), 'inside')
  await symlink(join(product, 'internal'), join(product, 'absolute'), 'file')
  await assert.rejects(assertContainedProductLinks(product), /absolute/)
})
