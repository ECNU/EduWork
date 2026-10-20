// Build every published artifact into lib/. The Host plugin and the relay
// bundle their dependencies, with the pure JavaScript sodium in place of the
// native addon, so installing the package compiles and loads nothing native.
// The license of every bundled package is collected into
// lib/THIRD_PARTY_LICENSES.txt; an unreviewed license fails the build.
//
//   node scripts/build.ts
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build, type BuildOptions } from 'esbuild'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as { name: string }
const LICENSES = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause'])
// For ISC packages that ship no license file; the notice must still travel with the code.
const ISC = `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is
hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`

const common: BuildOptions = { absWorkingDir: fileURLToPath(root), bundle: true, metafile: true, logLevel: 'warning' }
const node: BuildOptions = { ...common, platform: 'node', format: 'esm', target: 'node24', alias: { 'sodium-native': 'sodium-javascript' } }
const web: BuildOptions = { ...common, platform: 'browser', target: ['es2022', 'safari16'], minify: true }

await rm(new URL('lib/', root), { recursive: true, force: true })
const results = await Promise.all([
  build({ ...node, entryPoints: ['src/plugin.ts'], outfile: 'lib/index.js', external: ['@deepseek-ai/*'] }),
  build({ ...node, entryPoints: ['src/typert.ts'], outfile: 'lib/typert.js', external: ['zod'] }),
  // The settings page, in the module format DSH clients load plugin pages in.
  build({
    ...web, entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', format: 'cjs', target: 'es2022', jsx: 'automatic',
    external: ['react', 'react/*', '@deepseek-ai/dsh-client-ui-primitives'],
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
])
await cp(new URL('src/web/static/', root), new URL('lib/web/', root), { recursive: true })

// Each bundled package directory, nested ones included.
const bundled = new Set<string>()
for (const { metafile } of results) {
  for (const input of Object.keys(metafile!.inputs)) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)
    if (match !== null) bundled.add(match[1]!)
  }
}
const notices = await Promise.all([...bundled].sort().map(async directory => {
  const dir = new URL(`${directory}/`, root)
  const pkg = JSON.parse(await readFile(new URL('package.json', dir), 'utf8')) as { name: string; version: string; license: string; author?: string }
  if (!LICENSES.has(pkg.license)) throw new Error(`review the license of ${pkg.name}: ${pkg.license}`)
  const file = (await readdir(dir)).find(name => /^(licen[cs]e|copying)/i.test(name))
  let text: string
  if (file !== undefined) text = (await readFile(new URL(file, dir), 'utf8')).trim()
  else if (pkg.license === 'ISC' && typeof pkg.author === 'string') text = `Copyright (c) ${pkg.author}\n\n${ISC}`
  else throw new Error(`${pkg.name} ships no license file; add its notice by hand`)
  return `${pkg.name} ${pkg.version} (${pkg.license})\n\n${text}`
}))
await writeFile(new URL('lib/THIRD_PARTY_LICENSES.txt', root), `${notices.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`)
console.log(`built ${manifest.name} with ${notices.length} bundled packages`)
