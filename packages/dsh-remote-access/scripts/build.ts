// Build every published artifact into lib/. The Host plugin and the relay
// bundle their dependencies, with the pure JavaScript sodium in place of the
// native addon, so installing the package compiles and loads nothing native.
//
//   node scripts/build.ts
import { readFile } from 'node:fs/promises'
import { build, type BuildOptions } from 'esbuild'

const root = new URL('../', import.meta.url).pathname
const manifest = JSON.parse(await readFile(new URL('package.json', `file://${root}`), 'utf8')) as { name: string }

const node: BuildOptions = {
  absWorkingDir: root, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning',
  alias: { 'sodium-native': 'sodium-javascript' },
}

await Promise.all([
  build({ ...node, entryPoints: ['src/plugin.ts'], outfile: 'lib/index.js', external: ['@deepseek-ai/*'] }),
  build({ ...node, entryPoints: ['src/typert.ts'], outfile: 'lib/typert.js', external: ['zod'] }),
  // The settings page, in the module format DSH clients load plugin pages in.
  build({
    absWorkingDir: root, entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', logLevel: 'warning',
    bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', minify: true, jsx: 'automatic',
    external: ['react', 'react/*'],
    banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
    footer: { js: 'return module.exports; } });' },
  }),
])
console.log(`built ${manifest.name}`)
