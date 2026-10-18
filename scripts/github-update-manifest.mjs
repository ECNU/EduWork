import {readFile,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {desktopVersion} from './desktop-build-plan.mjs'
import {windowsDeltaName} from './windows-update-delta.mjs'

export const updateManifestName='update-windows-amd64.json'
export function releaseChannel(version) {
 return desktopVersion(version).channel
}
export function githubUpdateManifest(receipt,repository) {
 const editions={'ecnu/eduwork':['EduWork','eduwork'],'ecnu/eduwork-ecnu':['EduWork-ECNU','eduwork-chatecnu']}
 const identity=editions[repository?.toLowerCase()]
 const channel=releaseChannel(receipt.version)
 const qualifiedSource=receipt.kind===(channel==='stable'?'eduwork-source-release':'eduwork-source-alpha') && receipt.platform==='windows' && receipt.automaticUpdates===true && receipt.checks?.updateContract==='passed'
 if(!identity || receipt.passed!==true || (!qualifiedSource && (receipt.kind!=='eduwork-windows-release' || receipt.platform!=='windows-x64')) || receipt.edition!==identity[0] || receipt.distribution!==identity[1] || receipt.shell!=='electron')throw Error('Update manifest requires a matching validated Electron release')
 const asset=receipt.asset
 if(asset?.name!==`${identity[0]}-${receipt.version}-windows-x64-electron.zip` || !Number.isSafeInteger(asset.bytes) || asset.bytes<1 || asset.bytes>=2**31 || !/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid update asset')
 const release=`https://github.com/ecnu/${identity[0]}/releases/download/v${receipt.version}/`
 // Older clients ignore `deltas` and download the complete package.
 const deltas=(receipt.deltas??[]).map(delta=>{
  if(delta.name!==windowsDeltaName(identity[0],receipt.version,delta.from) || !Number.isSafeInteger(delta.bytes) || delta.bytes<1 || !/^[a-f0-9]{64}$/.test(delta.sha256) || !/^[a-f0-9]{64}$/.test(delta.fromManifestSha256))throw Error('Invalid delta update')
  return {fromVersion:delta.from,fromManifestSha256:delta.fromManifestSha256,fileName:delta.name,bytes:delta.bytes,sha256:delta.sha256,url:release+delta.name,sha256Url:release+delta.name+'.sha256'}
 })
 return {schemaVersion:1,distribution:identity[1],channel,version:receipt.version,target:'windows-amd64',artifacts:[{shell:'electron',flavor:'offline',fileName:asset.name,bytes:asset.bytes,sha256:asset.sha256,url:release+asset.name,sha256Url:release+asset.name+'.sha256',...(deltas.length?{deltas}:{})}]}
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
