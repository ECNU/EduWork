import {transform} from 'esbuild'
import {readFile,writeFile} from 'node:fs/promises'
const source = new URL('../packages/artifact-services/templates/structured/video-template.jsx', import.meta.url)
const result = await transform(await readFile(source,'utf8'), {loader:'jsx',format:'esm',jsx:'transform'})
await writeFile(new URL('../packages/artifact-services/lib/video-template.js',import.meta.url), '// Generated from packages/artifact-services/templates/structured/video-template.jsx; run npm run build:media.\n'+result.code)
