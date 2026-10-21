import { build } from 'esbuild'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await build({ absWorkingDir: root, entryPoints: ['src/index.js'], outfile: 'lib/index.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node24' })
await build({
  absWorkingDir: root, entryPoints: ['src/client/index.js'], outfile: 'lib/client.js',
  bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', minify: true,
  external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
