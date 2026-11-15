import {build} from 'esbuild'
import {copyFile, mkdir, readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await mkdir(new URL('../lib/', import.meta.url), {recursive: true})
for (const name of ['index.js', 'discovery.js', 'connections.js', 'remote.js', 'typert.js']) await copyFile(new URL('../src/' + name, import.meta.url), new URL('../lib/' + name, import.meta.url))
await build({absWorkingDir: root, entryPoints: ['src/client.js'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', external: ['react', 'react/*'],
  banner: {js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`},
  footer: {js: 'return module.exports;}});'},
})
