import {readFile,stat} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// Audio overview and video both load this file from the shared service package.
// A legacy copy under Knowledge Studio does not satisfy that runtime contract.
export async function verifyMediaTemplate(artifactRoot) {
  const file = 'lib/video-template.js'
  const path = join(artifactRoot, file)
  const manifest = JSON.parse(await readFile(join(artifactRoot, 'package.json'), 'utf8'))
  if (manifest.name !== '@eduwork/dsh-artifact-services' || manifest.exports?.['./video-template'] !== './' + file) {
    throw new Error(`Invalid shared media template export: ${artifactRoot}`)
  }
  const info = await stat(path).catch(error => {
    if (error.code !== 'ENOENT') throw error
    throw new Error(`Missing media template: ${path}. Build media assets before assembling the product.`, {cause:error})
  })
  if (!info.isFile() || !info.size) throw new Error(`Invalid or empty media template: ${path}`)
  const content = await readFile(path)
  if (!content.toString('utf8').trim()) throw new Error(`Empty media template: ${path}`)
  return {package:manifest.name, file, bytes:content.length, sha256:createHash('sha256').update(content).digest('hex')}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Use verify-media-template.mjs <assembled product directory>')
  console.log(JSON.stringify(await verifyMediaTemplate(join(resolve(process.argv[2]), 'd/node_modules/@eduwork/dsh-artifact-services')), null, 2))
}
