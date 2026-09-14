import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { 'pdf-runtime': 'src/host/pdf-runtime.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: specifier => specifier.startsWith('node:'),
    alwaysBundle: specifier => !specifier.startsWith('node:'),
  },
  outputOptions: {
    entryFileNames: 'pdf-runtime.js',
    chunkFileNames: '[name].js',
  },
})
