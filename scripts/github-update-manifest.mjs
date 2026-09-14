import {readFile,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

export const updateManifestName='update-windows-amd64.json'
export function releaseChannel(version) {
 if(typeof version!=='string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.\d{8}\.[1-9]\d*)?$/.test(version))throw Error('Release version must be X.Y.Z or X.Y.Z-dev.YYYYMMDD.N')
 return version.includes('-dev.')?'development':'stable'
}
export function githubUpdateManifest(receipt,repository) {
 const editions={'ecnu/eduwork':['EduWork','eduwork'],'ecnu/eduwork-ecnu':['EduWork-ECNU','eduwork-chatecnu']}
 const identity=editions[repository?.toLowerCase()]
 const channel=releaseChannel(receipt.version)
 if(!identity || receipt.passed!==true || receipt.kind!=='eduwork-windows-release' || receipt.edition!==identity[0] || receipt.distribution!==identity[1] || receipt.shell!=='electron' || receipt.platform!=='windows-x64')throw Error('Update manifest requires a matching validated Electron release')
 const asset=receipt.asset
 if(asset?.name!==`${identity[0]}-${receipt.version}-windows-x64-electron.zip` || !Number.isSafeInteger(asset.bytes) || asset.bytes<1 || asset.bytes>=2**31 || !/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid update asset')
 const url=`https://github.com/ecnu/${identity[0]}/releases/download/v${receipt.version}/${asset.name}`
 return {schemaVersion:1,distribution:identity[1],channel,version:receipt.version,target:'windows-amd64',artifacts:[{shell:'electron',flavor:'offline',fileName:asset.name,bytes:asset.bytes,sha256:asset.sha256,url,sha256Url:url+'.sha256'}]}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const receipt=JSON.parse(await readFile(process.argv[2],'utf8'))
 await writeFile(join(dirname(resolve(process.argv[2])),updateManifestName),JSON.stringify(githubUpdateManifest(receipt,process.argv[3]),null,2)+'\n')
}
