import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { releaseIdentity } from '../dsh-host/release-policy.mjs'

export async function verifyProductReleaseIdentity(product, version) {
  const identity=JSON.parse(await readFile(join(product,'assembly.json'),'utf8'))
  if(identity.version!==version)throw Error('Desktop version differs from assembled product')
  const release=releaseIdentity(version,identity.dshVersion)
  const client=await readFile(join(product,'d/node_modules/@chatecnu-work/dsh-client-ui-conversation-brand/lib/client.js'),'utf8')
  const badges=[...client.matchAll(/"hero\.preview":\s*"([^"]*)"/g)].map(match=>match[1])
  if(badges.length!==2||!badges.includes(release.badge.zh)||!badges.includes(release.badge.en)) {
    throw Error('Product badge differs from version; rebuild conversation branding for this product version')
  }
  return release
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyProductReleaseIdentity(process.argv[2],process.argv[3])))
}
