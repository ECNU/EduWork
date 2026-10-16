// Bundle the calendar panel's client half for a headless render.
//
// The client half is TypeScript written against the product's primitives package
// and the desktop shell's runtime. This esbuild bundle is only a test fixture;
// product artifacts use the locked tsdown build. The test maps UI primitives
// to a plain-element stand-in. Everything else — the panel's own logic,
// which service methods it calls, and the code that reads a note back — is the
// real source, so a render proves the real client wiring rather than a copy of it.
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const pluginRoot = resolve(here, '..', '..')
const runtime = resolve(process.env.EDUWORK_TEST_RUNTIME)

const require = createRequire(join(runtime, 'package.json'))
const { build } = require('esbuild')

const outdir = join(here, '..', '.render')
await mkdir(outdir, { recursive: true })
const outfile = join(outdir, 'calendar-panel.cjs')

await build({
  absWorkingDir: pluginRoot,
  entryPoints: [join(pluginRoot, 'src/client.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  minify: false,
  sourcemap: false,
  nodePaths: [join(runtime, 'node_modules')],
  external: [
    'react', 'react/*', 'react-dom', 'react-dom/*', 'react-dom/server',
    '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-dockkit',
  ],
  alias: {
    '@deepseek-ai/dsh-client-ui-primitives': join(pluginRoot, 'test/support/ui-primitives-stub.js'),
  },
  define: { 'process.env.NODE_ENV': '"test"', __EDUWORK_PINNED_DSH__: 'true' },
  logLevel: 'warning',
})

console.log(outfile)
