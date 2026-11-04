import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtime = process.env.EDUWORK_SIDE_CHAT_RUNTIME

test('failure toast renders its warning icon, translated text and dismiss action', { skip: !runtime }, async () => {
  const runtimeRequire = createRequire(join(runtime, 'package.json'))
  const { build } = createRequire(import.meta.url)('esbuild')
  const React = runtimeRequire('react')
  const { renderToStaticMarkup } = runtimeRequire('react-dom/server')
  const output = await build({
    entryPoints: [fileURLToPath(new URL('../src/client/primitives.jsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'runtime-react', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({
        path: pathToFileURL(runtimeRequire.resolve('react')).href, external: true,
      }))
    } }],
  })
  const { Toast, IconWarningOutlineRegular } = await import(
    'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))
  const html = renderToStaticMarkup(React.createElement(Toast, {
    text: '操作失败，请重试。', icon: React.createElement(IconWarningOutlineRegular),
    actions: [{ label: '关闭', onClick() {} }],
  }))
  assert.match(html, /role="status"/)
  assert.match(html, /<svg/)
  assert.match(html, /操作失败，请重试。/)
  assert.match(html, /<button[^>]*>关闭<\/button>/)
})
