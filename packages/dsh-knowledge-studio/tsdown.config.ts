import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'

const external = (specifier: string): boolean => specifier === 'react' || specifier.startsWith('react/') || specifier === 'react-dom'
const clientShim = (name: string) => fileURLToPath(new URL(`./src/client/shims/${name}.ts`, import.meta.url))

export default defineConfig({
  entry: { client: 'src/client/index.tsx' }, outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022',
  alias: {
    'node:process': clientShim('process'),
    'node:path': clientShim('path'),
    'node:url': clientShim('url'),
  },
  dts: false, sourcemap: false, clean: false,
  deps: { neverBundle: external, alwaysBundle: specifier => !external(specifier) },
  inputOptions: { resolve: { conditionNames: ['browser', 'import', 'require', 'default'], aliasFields: [['browser']] } },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@eduwork/dsh-knowledge-studio", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
