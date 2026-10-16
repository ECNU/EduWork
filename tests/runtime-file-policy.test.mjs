import test from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pruneRuntimeFiles, runtimeFileExclusion } from '../scripts/lib/runtime-file-policy.mjs'

const targets = ['darwin-arm64', 'win32-x64']
const linkType = process.platform === 'win32' ? 'junction' : 'dir'
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-runtime-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
async function put(root, path, content = path) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

test('only the listed file forms are excluded, with the innermost package controlling declarations', () => {
  for (const target of targets) {
    for (const path of ['app.js.map', 'app.mjs.map', 'app.cjs.map', 'app.ts.map', 'app.mts.map', 'app.cts.map', 'app.css.map', 'data.map', 'uppercase.MAP']) {
      assert.equal(runtimeFileExclusion(`resources/${path}`, target), 'source map')
    }
    for (const suffix of ['d.ts', 'd.mts', 'd.cts']) {
      assert.equal(runtimeFileExclusion(`d/node_modules/other/index.${suffix}`, target), 'TypeScript declaration')
      assert.equal(runtimeFileExclusion(`d/node_modules/typescript/lib/index.${suffix}`, target), undefined)
      assert.equal(runtimeFileExclusion(`d/node_modules/outer/node_modules/typescript/lib/index.${suffix}`, target), undefined)
      assert.equal(runtimeFileExclusion(`d/node_modules/typescript/node_modules/other/index.${suffix}`, target), 'TypeScript declaration')
      assert.equal(runtimeFileExclusion(`resources/index.${suffix}`, target), undefined)
    }
    for (const path of ['node_modules/.bin/tool', 'node_modules/.pnpm/lock.yaml', 'node_modules/.modules.yaml', 'node_modules/.pnpm-workspace-state-v1.json', 'resources/model.tsbuildinfo', 'node_modules/other/src/code.ts', 'node_modules/other/test/test.js', 'node_modules/fs-ext/build/Release/fs_ext.node']) {
      assert.equal(runtimeFileExclusion(path, target), undefined, path)
    }
    assert.equal(runtimeFileExclusion('resources/native.pdb', target), 'debug symbols')
    assert.equal(runtimeFileExclusion('resources/uppercase.PDB', target), 'debug symbols')
    assert.equal(runtimeFileExclusion('r/__pycache__', target), 'python bytecode')
    assert.equal(runtimeFileExclusion('r/module.pyc', target), 'python bytecode')
    assert.equal(runtimeFileExclusion('r/uppercase.PYC', target), 'python bytecode')
    assert.equal(runtimeFileExclusion('d/node_modules/other/cache.tsbuildinfo', target), 'TypeScript build cache')
    assert.equal(runtimeFileExclusion(`d/node_modules/@deepseek-ai/libreoffice-kit-${target}`, target), undefined)
    assert.equal(runtimeFileExclusion('d/node_modules/@deepseek-ai/libreoffice-kit-linux-x64', target), 'LibreOffice other platform')
    assert.equal(runtimeFileExclusion('d/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.lib', target), 'Koffi import library')
  }
})

for (const target of targets) {
  test(`pruning ${target} removes each category and retains runtime and unknown files`, async t => {
    const root = await fixture(t)
    const other = targets.find(value => value !== target)
    const excluded = [
      ['resources/native.pdb', 'debug symbols'],
      ['resources/uppercase.PDB', 'debug symbols'],
      ['r/module.pyc', 'python bytecode'],
      ['r/uppercase.PYC', 'python bytecode'],
      ['r/__pycache__/cache.txt', 'python bytecode'],
      ['resources/client.mjs.map', 'source map'],
      ['resources/data.map', 'source map'],
      ['resources/uppercase.MAP', 'source map'],
      ['d/node_modules/other/data.map', 'source map'],
      ['d/node_modules/other/index.d.ts', 'TypeScript declaration'],
      ['d/node_modules/other/index.d.mts', 'TypeScript declaration'],
      ['d/node_modules/other/index.d.cts', 'TypeScript declaration'],
      ['d/node_modules/typescript/node_modules/child/index.d.ts', 'TypeScript declaration'],
      ['d/node_modules/other/cache.tsbuildinfo', 'TypeScript build cache'],
      [`d/node_modules/@deepseek-ai/libreoffice-kit-${other}/runtime.bin`, 'LibreOffice other platform'],
      ['d/node_modules/fs-ext/build/Release/obj/deep/output.obj', 'fs-ext compiler output'],
      ['d/node_modules/fs-ext/build/Debug/fs_ext.exp', 'fs-ext compiler output'],
      ['d/node_modules/fs-ext/build/Release/fs_ext.lib', 'fs-ext compiler output'],
      ['d/node_modules/fs-ext/build/Debug/fs_ext.iobj', 'fs-ext compiler output'],
      ['d/node_modules/fs-ext/build/Release/fs_ext.ipdb', 'fs-ext compiler output'],
      ['d/node_modules/fs-ext/build/binding.sln', 'fs-ext build configuration'],
      ['d/node_modules/fs-ext/build/config.gypi', 'fs-ext build configuration'],
      ['d/node_modules/fs-ext/build/fs_ext.vcxproj', 'fs-ext build configuration'],
      ['d/node_modules/fs-ext/build/fs_ext.vcxproj.filters', 'fs-ext build configuration'],
      ['d/node_modules/@mixmark-io/domino/test/deep/test.js', 'Domino test fixtures'],
      [`d/node_modules/node-pty/prebuilds/${other}/pty.node`, 'node-pty other platform'],
      [`d/node_modules/node-pty/prebuilds/${other}/pty.pdb`, 'node-pty other platform'],
      [`d/node_modules/node-pty/prebuilds/${target}/pty.pdb`, 'debug symbols'],
      ['d/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.lib', 'Koffi import library'],
    ]
    const retained = [
      'd/node_modules/typescript/lib/lib.es5.d.ts',
      'd/node_modules/outer/node_modules/typescript/lib/lib.es5.d.ts',
      'd/node_modules/.bin/tool',
      'd/node_modules/.pnpm/lock.yaml',
      'd/node_modules/.modules.yaml',
      `d/node_modules/node-pty/prebuilds/${target}/pty.node`,
      `d/node_modules/@deepseek-ai/libreoffice-kit-${target}/runtime.bin`,
      'd/node_modules/other/src/code.js',
      'd/node_modules/other/src/code.ts',
      'd/node_modules/other/test/test.js',
      'd/node_modules/fs-ext/build/Release/fs_ext.node',
      'resources/types.d.ts',
      'resources/code.ts',
    ]
    const expected = { files: excluded.length, bytes: 0, reasons: {} }
    for (const [path, reason] of excluded) {
      await put(root, path)
      const bytes = Buffer.byteLength(path)
      expected.bytes += bytes
      const count = expected.reasons[reason] ??= { files: 0, bytes: 0 }
      count.files++
      count.bytes += bytes
    }
    for (const path of retained) await put(root, path)
    const link = join(root, 'linked-prebuilds')
    await symlink(join(root, `d/node_modules/node-pty/prebuilds/${other}`), link, linkType)

    assert.deepEqual(await pruneRuntimeFiles(root, target), expected)
    for (const [path] of excluded) await assert.rejects(lstat(join(root, path)), { code: 'ENOENT' })
    for (const path of retained) assert.equal(await readFile(join(root, path), 'utf8'), path)
    for (const path of ['r/__pycache__', `d/node_modules/@deepseek-ai/libreoffice-kit-${other}`, 'd/node_modules/fs-ext/build/Release/obj', 'd/node_modules/@mixmark-io/domino/test', `d/node_modules/node-pty/prebuilds/${other}`]) {
      await assert.rejects(lstat(join(root, path)), { code: 'ENOENT' })
    }
    assert.ok((await lstat(link)).isSymbolicLink(), 'The link survives after its excluded target is deleted')
    assert.deepEqual(await pruneRuntimeFiles(root, target), { files: 0, bytes: 0, reasons: {} })
  })
}

test('excluded directories remove their links while top-level links and external targets survive', async t => {
  const root = await fixture(t)
  const product = join(root, 'product')
  const outside = join(root, 'outside')
  await put(outside, 'native.pdb', 'keep')
  await put(product, 'd/node_modules/@mixmark-io/domino/test/deleted.js', 'cut')
  const inside = join(product, 'd/node_modules/@mixmark-io/domino/test/linked-cache')
  const excludedLink = join(product, '__pycache__')
  await symlink(outside, inside, linkType)
  await symlink(outside, excludedLink, linkType)
  assert.deepEqual(await pruneRuntimeFiles(product, 'darwin-arm64'), {
    files: 1, bytes: 3, reasons: { 'Domino test fixtures': { files: 1, bytes: 3 } },
  })
  await assert.rejects(lstat(inside), { code: 'ENOENT' })
  assert.ok((await lstat(excludedLink)).isSymbolicLink())
  assert.equal(await readFile(join(outside, 'native.pdb'), 'utf8'), 'keep')
})
