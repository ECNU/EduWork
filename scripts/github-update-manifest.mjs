import {readFile,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {desktopVersion} from './desktop-build-plan.mjs'

export const updateManifestName='update-windows-amd64.json'
export function releaseChannel(version) {
 return desktopVersion(version).channel
}
export function githubUpdateManifest(receipt,repository) {
 const editions={'ecnu/eduwork':['EduWork','eduwork'],'ecnu/eduwork-ecnu':['EduWork-ECNU','eduwork-chatecnu']}
 const identity=editions[repository?.toLowerCase()]
 const channel=releaseChannel(receipt.version)
 const qualifiedSource=receipt.kind==='eduwork-source-release' && channel==='stable' && receipt.platform==='windows' && receipt.automaticUpdates===true && receipt.checks?.updateContract==='passed'
 if(!identity || receipt.passed!==true || (!qualifiedSource && (receipt.kind!=='eduwork-windows-release' || receipt.platform!=='windows-x64')) || receipt.edition!==identity[0] || receipt.distribution!==identity[1] || receipt.shell!=='electron')throw Error('Update manifest requires a matching validated Electron release')
 const asset=receipt.asset
 if(asset?.name!==`${identity[0]}-${receipt.version}-windows-x64-electron.zip` || !Number.isSafeInteger(asset.bytes) || asset.bytes<1 || asset.bytes>=2**31 || !/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid update asset')
 const url=`https://github.com/ecnu/${identity[0]}/releases/download/v${receipt.version}/${asset.name}`
 return {schemaVersion:1,distribution:identity[1],channel,version:receipt.version,target:'windows-amd64',artifacts:[{shell:'electron',flavor:'offline',fileName:asset.name,bytes:asset.bytes,sha256:asset.sha256,url,sha256Url:url+'.sha256'}]}
}
// Older clients cache metadata as json.RawMessage. Emit bytes that survive
// Go JSON compaction/HTML escaping so they can still verify and upgrade.
export function githubUpdateManifestBytes(receipt,repository) {
 return JSON.stringify(githubUpdateManifest(receipt,repository)).replace(/[<>&\u2028\u2029]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const receipt=JSON.parse(await readFile(process.argv[2],'utf8'))
 await writeFile(join(dirname(resolve(process.argv[2])),updateManifestName),githubUpdateManifestBytes(receipt,process.argv[3]))
}
