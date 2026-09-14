import { build } from 'esbuild'
import { mkdir, readdir, copyFile, readFile } from 'node:fs/promises'
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
await mkdir('lib', { recursive: true })
for (const file of await readdir('src/host')) if (file.endsWith('.js')) await copyFile('src/host/' + file, 'lib/' + file)
await build({
  entryPoints: ['src/client/index.ts'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', external: ['react'],
  mainFields: ['module', 'main'], minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline',
  banner: { js: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(pkg.name) + ', factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
})
