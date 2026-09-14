import { defineConfig } from 'tsdown'

const external = (specifier: string): boolean => ['react', 'react-dom'].includes(specifier) || specifier.startsWith('react/') || specifier.startsWith('react-dom/')

export default defineConfig({
  failOnWarn: true,
  entry: { client: 'src/client.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: external,
    alwaysBundle: specifier => !external(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@eduwork/workbench-native", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
