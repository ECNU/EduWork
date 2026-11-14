import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.EDUWORK_MESSAGE_EDIT_RUNTIME) throw Error('Set EDUWORK_MESSAGE_EDIT_RUNTIME to the locked DSH Runtime directory')
const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
// DSH packages come from the locked Runtime: the Host provides them at run
// time, and the client bundle carries only the Remote descriptor helper.
const nodePaths = [join(resolve(process.env.EDUWORK_MESSAGE_EDIT_RUNTIME), 'node_modules')]
await build({ absWorkingDir: root, entryPoints: ['src/index.js', 'src/typert.host.js'], outdir: 'lib',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external' })
// The page shares React, the UI primitives, and zod between plugins.
await build({ absWorkingDir: root, entryPoints: ['src/client/index.jsx'], outfile: 'lib/client.js', nodePaths,
  bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', minify: true, external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/dsh-client-ui-primitives', 'zod'],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
