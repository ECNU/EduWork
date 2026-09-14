import { readFile, readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {githubUpdateManifestBytes,updateManifestName,releaseChannel} from './github-update-manifest.mjs'

export function releasePublication(edition,version) {
  const prerelease=releaseChannel(version)==='development'
  return {name:`${edition} ${version}（${prerelease?'开发版':'公测版'}）`,prerelease,make_latest:prerelease?'false':'true'}
}

export function validateReceipt(receipt, {repository, version, commit}) {
  const edition = {'ecnu/eduwork':'EduWork','ecnu/eduwork-ecnu':'EduWork-ECNU'}[repository?.toLowerCase()]
  releaseChannel(version)
  if (!edition || !/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid release repository/version/commit')
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'eduwork-windows-release' || receipt.passed !== true || receipt.version !== version || receipt.edition !== edition || receipt.shell !== 'electron' || receipt.platform !== 'windows-x64' || receipt.editionCommit !== commit) throw Error('Release identity or validation does not match this workflow')
  if (receipt.validationProfile !== 'ci-build-and-launch-v1') throw Error('Unknown release validation scope')
  if (receipt.releaseNotes?.approved !== true || !/^[a-f0-9]{64}$/.test(receipt.releaseNotes?.sha256 ?? '')) throw Error('Discussed and approved release notes are required')
  for (const check of ['sourceAndDependencies','desktopLaunch','archiveManifest']) {
    if (receipt.checks?.[check] !== 'passed') throw Error('Release check did not pass: '+check)
  }
  if (receipt.asset?.name !== `${edition}-${version}-windows-x64-electron.zip` || !/^[a-f0-9]{64}$/.test(receipt.asset.sha256) || !Number.isSafeInteger(receipt.asset.bytes) || receipt.asset.bytes < 1) throw Error('Invalid release ZIP')
  return edition
}
async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function publish(directory) {
  if (process.env.RELEASE_NOTES_APPROVED !== 'true') throw Error('Release notes require explicit maintainer approval')
  const root=resolve(directory), repository=process.env.GITHUB_REPOSITORY, version=process.env.RELEASE_VERSION, commit=process.env.GITHUB_SHA
  const receipt=JSON.parse(await readFile(join(root,'release-receipt.json'),'utf8'))
  const edition=validateReceipt(receipt,{repository,version,commit})
  if (!process.env.GITHUB_TOKEN) throw Error('Release job token is required')
  const expected = [receipt.asset.name,receipt.asset.name+'.sha256','release-receipt.json','RELEASE-NOTES.md',updateManifestName]
  const actual=await readdir(root)
  if (actual.length!==expected.length || expected.some(name=>!actual.includes(name))) throw Error('Unexpected files in release artifact')
  const files=[]
  for (const name of expected) {
    const path=join(root,name), info=await stat(path)
    if (!info.isFile()) throw Error('Release asset is not a regular file')
    files.push({name,path,bytes:info.size,sha256:await hashFile(path)})
  }
  const zip=files[0]
  if(files[3].sha256!==receipt.releaseNotes.sha256) throw Error('Release notes differ from the approved source file')
  if(zip.bytes!==receipt.asset.bytes || zip.sha256!==receipt.asset.sha256) throw Error('Downloaded CI artifact differs from the validated ZIP')
  if((await readFile(files[1].path,'utf8')).trim()!==`${zip.sha256}  ${zip.name}`) throw Error('SHA256 sidecar differs')
  if((await readFile(files[4].path,'utf8'))!==githubUpdateManifestBytes(receipt,repository))throw Error('GitHub update manifest differs from the validated release or legacy-compatible encoding')
  const headers={Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'EduWork-Release-CI','X-GitHub-Api-Version':'2022-11-28'}
  const api=`https://api.github.com/repos/${repository}`
  async function request(path, options={}, missing=false) {
    const response=await fetch(api+path,{...options,headers:{...headers,...options.headers}})
    if(missing && response.status===404) return null
    if(!response.ok) throw Error(`GitHub Release API ${response.status}: ${path}`)
    return response.status===204?null:response.json()
  }
  const tag='v'+version
  const publication=releasePublication(edition,version)
  let ref=await request('/git/ref/tags/'+tag,{},true)
  if(ref && (ref.object.type!=='commit' || ref.object.sha!==commit)) throw Error('Release tag already points to another commit')
  let release=await request('/releases/tags/'+tag,{},true)
  // Drafts are not returned by all tag lookups; use the authenticated list too.
  if(!release) release=(await request('/releases?per_page=100')).find(row=>row.tag_name===tag)
  if(release && release.target_commitish!==commit) throw Error('Existing release has a different source target')
  if(release && release.prerelease!==publication.prerelease)throw Error('Existing release has a different channel')
  if(!release) release=await request('/releases',{method:'POST',body:JSON.stringify({...publication,tag_name:tag,target_commitish:commit,body:await readFile(join(root,'RELEASE-NOTES.md'),'utf8'),draft:true,make_latest:'false'})})
  for(const file of files) {
    const existing=release.assets.find(asset=>asset.name===file.name)
    if(existing) {
      if(existing.size!==file.bytes || existing.digest!==`sha256:${file.sha256}`) throw Error('Existing release asset has different bytes; refusing replacement: '+file.name)
      continue
    }
    if(!release.draft) throw Error('Published release is incomplete; refusing to mutate it')
    const upload=new URL(release.upload_url.replace(/\{.*$/,''))
    if(upload.origin!=='https://uploads.github.com') throw Error('Unexpected release upload host')
    upload.searchParams.set('name',file.name)
    const response=await fetch(upload,{method:'POST',headers:{...headers,'Content-Type':file.name.endsWith('.zip')?'application/zip':'application/octet-stream','Content-Length':String(file.bytes)},body:createReadStream(file.path),duplex:'half'})
    if(!response.ok) throw Error(`Upload failed: ${file.name}, HTTP ${response.status}; draft retained`)
    const result=await response.json()
    if(result.size!==file.bytes || result.digest!==`sha256:${file.sha256}`) throw Error('GitHub asset digest differs: '+file.name)
    console.log('Uploaded and verified '+file.name)
  }
  if(release.draft) release=await request('/releases/'+release.id,{method:'PATCH',body:JSON.stringify({draft:false,prerelease:publication.prerelease,make_latest:publication.make_latest})})
  ref=await request('/git/ref/tags/'+tag)
  if(ref.object.sha!==commit) throw Error('Published tag does not match the tested commit')
  console.log('Published '+release.html_url)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await publish(process.argv[2])
