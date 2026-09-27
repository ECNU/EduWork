import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function buildVideoTemplate(packageRoot, transform) {
  const source = join(packageRoot, 'templates/structured/video-template.jsx')
  const destination = join(packageRoot, 'lib/video-template.js')
  const result = await transform(await readFile(source, 'utf8'), { loader: 'jsx', format: 'esm', jsx: 'transform' })
  await writeFile(destination, '// Generated from packages/artifact-services/templates/structured/video-template.jsx; run npm run build:media.\n' + result.code)
  return destination
}
