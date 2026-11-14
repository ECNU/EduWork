// Plain ESM: copy the modules; the Host provides schemastery and the decision client comes from npm. The client part
// imports nothing, so it is only wrapped for DSH's client module loader.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
const src = new URL('../src/', import.meta.url), lib = new URL('../lib/', import.meta.url)
await mkdir(lib, { recursive: true })
for (const file of ['index.js', 'review.js', 'rules.js', 'questions.js']) await copyFile(new URL(file, src), new URL(file, lib))
const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const client = await readFile(new URL('client.cjs', src), 'utf8')
await writeFile(new URL('client.js', lib), `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n${client}\nreturn module.exports; } });\n`)
