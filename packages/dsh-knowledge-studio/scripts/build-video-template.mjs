import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// Source qualification supplies its isolated package root and pinned compiler.
// npm run build:media keeps using this package's normal build dependencies.
export async function buildVideoTemplate({
  artifactRoot = fileURLToPath(new URL('../packages/artifact-services/', import.meta.url)),
  transform,
} = {}) {
  transform ??= (await import('esbuild')).transform
  const source = join(artifactRoot, 'templates/structured/video-template.jsx')
  const result = await transform(await readFile(source,'utf8'), {loader:'jsx',format:'esm',jsx:'transform'})
  await mkdir(join(artifactRoot, 'lib'), {recursive:true})
  const output = join(artifactRoot, 'lib/video-template.js')
  await writeFile(output, '// Generated from packages/artifact-services/templates/structured/video-template.jsx; run npm run build:media.\n'+result.code)
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildVideoTemplate()
