import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/host/index.js' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    alwaysBundle: () => true,
  },
  outputOptions: {
    entryFileNames: 'index.js',
  },
})
