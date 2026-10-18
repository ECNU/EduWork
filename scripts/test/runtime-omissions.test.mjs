import test from 'node:test'
import assert from 'node:assert/strict'
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { omitRuntimePackages, omittedRoots } from '../omit-runtime-packages.mjs'
import { patchRemotionBundlerSource } from '../patch-remotion-bundler-runtime.mjs'

const exists = path => access(path).then(() => true, () => false)
const linked = path => lstat(path).then(() => true, () => false)
async function install(runtime, path, manifest, bytes = 'x') {
  await mkdir(join(runtime, path), { recursive: true })
  await writeFile(join(runtime, path, 'package.json'), JSON.stringify({ version: '1.0.0', ...manifest }))
  await writeFile(join(runtime, path, 'index.js'), bytes)
}

test('omitted packages leave with what only they reach; declared and retained uses stay', async t => {
  const runtime = await mkdtemp(join(tmpdir(), 'eduwork-runtime-omissions-'))
  t.after(() => rm(runtime, { recursive: true, force: true }))
  const roots = Object.fromEntries([...omittedRoots, 'app', '@deepseek-ai/dsh', 'pdfjs-dist', '@remotion/bundler', 'css-loader', 'hoisted-root']
    .map(name => [name, '1.0.0']))
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'runtime', dependencies: roots }))
  for (const name of omittedRoots) {
    const generator = name === '@deepseek-ai/dsh-typert-generator'
    const dependencies = generator ? { typescript: '1', shared: '1', vitest: '1', 'hoisted-root': '1', nested: '1' } : {}
    await install(runtime, `node_modules/${name}`, { name, dependencies, ...generator ? { bin: { typert: 'index.js', vite: 'index.js' } } : {} })
  }
  await install(runtime, 'node_modules/@deepseek-ai/dsh-typert-generator/node_modules/nested', { name: 'nested' })
  await install(runtime, 'node_modules/vitest', { name: 'vitest', bin: 'index.js', dependencies: { vite: '1', chai: '1' } })
  await install(runtime, 'node_modules/chai', { name: 'chai' })
  // A product dependency outside the Runtime manifest, named by the caller.
  await install(runtime, 'node_modules/vite', { name: 'vite', bin: { vite: 'index.js' } })
  await mkdir(join(runtime, 'node_modules/.bin'))
  for (const [name, target] of [['vitest', 'vitest'], ['typert', '@deepseek-ai/dsh-typert-generator'], ['vite', 'vite']]) {
    // npm links commands on POSIX and writes shell shims on Windows.
    const bin = join(runtime, 'node_modules/.bin', name)
    if (process.platform === 'win32') await writeFile(bin, `#!/bin/sh\nexec node "$(dirname "$0")/../${target}/index.js" "$@"\n`)
    else await symlink(`../${target}/index.js`, bin)
    await writeFile(join(runtime, 'node_modules/.bin', `${name}.cmd`), `@"%~dp0\\..\\${target}\\index.js" %*`)
  }
  await install(runtime, 'node_modules/typescript', { name: 'typescript' })
  await install(runtime, 'node_modules/shared', { name: 'shared' })
  await install(runtime, 'node_modules/hoisted-root', { name: 'hoisted-root' })
  await install(runtime, 'node_modules/app', { name: 'app', dependencies: { shared: '1' } })
  await install(runtime, 'node_modules/@deepseek-ai/dsh', { name: '@deepseek-ai/dsh', dependencies: { '@deepseek-ai/dsh-experimental-voice-input-bundle': '1' } })
  await install(runtime, 'node_modules/@deepseek-ai/dsh-experimental-voice-input-bundle', { name: '@deepseek-ai/dsh-experimental-voice-input-bundle', dependencies: { '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice': '1' } })
  await install(runtime, 'node_modules/@deepseek-ai/dsh-experimental-speech-to-text-sensevoice', { name: '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice' })
  await install(runtime, 'node_modules/pdfjs-dist', { name: 'pdfjs-dist', optionalDependencies: { '@napi-rs/canvas': '1' } })
  await install(runtime, 'node_modules/@napi-rs/canvas', { name: '@napi-rs/canvas', optionalDependencies: { '@napi-rs/canvas-darwin-arm64': '1' } })
  await install(runtime, 'node_modules/@napi-rs/canvas-darwin-arm64', { name: '@napi-rs/canvas-darwin-arm64' }, 'native')
  await install(runtime, 'node_modules/@remotion/bundler', { name: '@remotion/bundler', dependencies: { '@rspack/core': '1', webpack: '1' } })
  await install(runtime, 'node_modules/@rspack/core', { name: '@rspack/core' })
  await install(runtime, 'node_modules/webpack', { name: 'webpack' })
  // An optional peer is supplied by its consumer and keeps nothing installed.
  await install(runtime, 'node_modules/css-loader', { name: 'css-loader', peerDependencies: { '@rspack/core': '1' }, peerDependenciesMeta: { '@rspack/core': { optional: true } } })

  const result = await omitRuntimePackages(runtime, ['vite'])
  assert.deepEqual(result.packages.map(item => item.replace(/@1\.0\.0$/, '')).sort(), [
    ...omittedRoots, 'nested', '@napi-rs/canvas', '@napi-rs/canvas-darwin-arm64', '@rspack/core', 'vitest', 'chai',
  ].sort())
  for (const kept of ['typescript', 'shared', 'hoisted-root', 'app', 'vite', 'webpack', 'pdfjs-dist', 'css-loader', '@deepseek-ai/dsh-experimental-voice-input-bundle', '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice']) {
    assert.ok(await exists(join(runtime, 'node_modules', kept, 'package.json')), kept)
  }
  for (const gone of [...omittedRoots, 'vitest', '@rspack/core', '@napi-rs/canvas-darwin-arm64']) assert.equal(await exists(join(runtime, 'node_modules', gone)), false, gone)
  assert.ok(result.bytes > 0)
  for (const link of ['vitest', 'vitest.cmd', 'typert', 'typert.cmd']) assert.equal(await linked(join(runtime, 'node_modules/.bin', link)), false, link)
  for (const link of ['vite', 'vite.cmd']) assert.ok(await exists(join(runtime, 'node_modules/.bin', link)), `retained command ${link}`)
  const manifest = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'))
  for (const name of omittedRoots) assert.equal(manifest.dependencies[name], undefined)
  assert.equal(manifest.dependencies.app, '1.0.0')
  await assert.rejects(omitRuntimePackages(runtime), /not installed/, 'a changed Runtime needs a reviewed list')
})

test('the Remotion bundler patch refuses unreviewed input', () => {
  assert.throws(() => patchRemotionBundlerSource('dist/bundle.js', Buffer.from('unreviewed Remotion')), /input changed/)
})

// A one-page PDF whose only text is drawn with a standard font.
function pdf(text) {
  const content = `BT /F1 12 Tf 10 50 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let body = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => { const offset = body.length; body += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  return Buffer.from(`${body}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1')
}

const product = process.env.EDUWORK_TEST_PRODUCT
test('the assembled product runs without the omitted packages', { skip: !product && 'Set EDUWORK_TEST_PRODUCT to an assembled source product' }, async () => {
  const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
  for (const name of [...omittedRoots, '@rspack/core', '@napi-rs/canvas', 'vitest']) {
    assert.ok(identity.omittedPackages.some(item => item.startsWith(name + '@')), name)
    assert.equal(await exists(join(product, 'd/node_modules', name)), false, name)
  }
  assert.deepEqual(identity.runtimePatches.filter(patch => patch.package === '@remotion/bundler').map(patch => patch.file), ['dist/index.js', 'dist/bundle.js'])
  const require = createRequire(join(product, 'd/package.json'))
  assert.ok(require.resolve('typescript'), 'Remotion reads project tsconfig.json with TypeScript')
  const bundler = require('@remotion/bundler')
  assert.equal(typeof bundler.bundle, 'function')
  assert.throws(() => bundler.BundlerInternals.rspackConfig({}), { code: 'MODULE_NOT_FOUND' })
  const { extractPdfText } = await import(pathToFileURL(require.resolve('@eduwork/dsh-literature/core')).href)
  assert.equal(await extractPdfText(pdf('EduWork omitted canvas')), 'EduWork omitted canvas')
})
