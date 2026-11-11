import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await build({ absWorkingDir: root, entryPoints: ['src/client.mjs'], outfile: 'lib/client.js', bundle: true, platform: 'browser', format: 'cjs',
  target: 'es2022', external: ['react', 'react/*', '@deepseek-ai/dsh-client-ui-primitives'],
  banner: { js: 'window.__ModuleLoader__.load({id:"@eduwork/dsh-password-manager",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' } })
