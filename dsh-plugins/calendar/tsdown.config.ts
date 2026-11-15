import { defineConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'

const external = (specifier: string): boolean =>
  ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'].includes(specifier)
  || specifier.startsWith('react/')
  || specifier.startsWith('react-dom/')

export default defineConfig({
  failOnWarn: true,
  entry: { client: 'src/client.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  plugins: [{
    name: 'calendar-inline-css',
    async resolveId(source, importer) {
      if (!source.endsWith('.css')) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      return resolved ? `\0calendar-css:${resolved.id}.js` : null
    },
    async load(id) {
      if (!id.startsWith('\0calendar-css:')) return null
      const path = id.slice('\0calendar-css:'.length, -'.js'.length)
      return `export default ${JSON.stringify(await readFile(path, 'utf8'))}`
    },
  }],
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: external,
    alwaysBundle: (specifier: string) => !external(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@eduwork/dsh-calendar", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
