// Plain ESM: preserve the adapter as small modules with host-provided imports.
import { copyFile, mkdir } from 'node:fs/promises'
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
for (const file of ['index.js', 'core.js']) await copyFile(new URL('../src/' + file, import.meta.url), new URL('../lib/' + file, import.meta.url))
