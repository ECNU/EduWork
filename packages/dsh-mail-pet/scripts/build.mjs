// The shell loads client plugins through `window.__ModuleLoader__.load`, so the
// bundle is a CommonJS factory wrapped in that call and React stays external.
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await build({
  absWorkingDir: root, entryPoints: ['src/client.js'], outfile: 'lib/client.js',
  bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', minify: true,
  external: ['react', 'react/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
