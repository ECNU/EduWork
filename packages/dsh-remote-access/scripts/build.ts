// Build every published artifact into lib/. The Host plugin and the relay
// bundle their dependencies, with the pure JavaScript sodium in place of the
// native addon, so installing the package compiles and loads nothing native.
//
//   node scripts/build.ts
import { cp, readFile, rm } from 'node:fs/promises'
import { build, type BuildOptions } from 'esbuild'

const root = new URL('../', import.meta.url).pathname
const manifest = JSON.parse(await readFile(new URL('package.json', `file://${root}`), 'utf8')) as { name: string }

const node: BuildOptions = {
  absWorkingDir: root, bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning',
  alias: { 'sodium-native': 'sodium-javascript' },
}

await rm(new URL('lib/', `file://${root}`), { recursive: true, force: true })
const web: BuildOptions = { absWorkingDir: root, bundle: true, platform: 'browser', target: ['es2022', 'safari16'], minify: true, logLevel: 'warning' }

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
  // The relay and the web client it serves: the loader page as a module, the
  // worker and the preamble as classic scripts (the preamble must run before DSH's own).
  build({
    ...node, entryPoints: ['src/relay/main.ts'], outfile: 'lib/relay.js', external: ['bufferutil', 'utf-8-validate'],
    // ws is CommonJS; give its requires a real `require` inside the ES module.
    banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);" },
  }),
  build({ ...web, entryPoints: ['src/web/loader.ts'], outfile: 'lib/web/loader.js', format: 'esm' }),
  build({ ...web, entryPoints: ['src/web/sw.ts'], outfile: 'lib/web/sw.js', format: 'iife' }),
  build({ ...web, entryPoints: ['src/web/preamble.ts'], outfile: 'lib/web/preamble.js', format: 'iife' }),
  cp(new URL('src/web/static/', `file://${root}`), new URL('lib/web/', `file://${root}`), { recursive: true }),
])
console.log(`built ${manifest.name}`)
