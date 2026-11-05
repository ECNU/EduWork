// Hosted, public-key-only packaging. It never invokes the local /ds operation.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signingGitHub, localSigningPolicy, unpackSafe, candidateWorkflow } from './lib/windows-signing-io.mjs'
import { validateRequest, validateResponse, requestHash, sha256, ownedWindowsFiles } from './lib/windows-signing-protocol.mjs'
import { createSigningRequest, ingestSigningResponse, verifyOwnedFiles, signingTool, fileIdentity } from './lib/windows-signing-operations.mjs'
import { validateSigningReceipt } from './lib/windows-signing-receipt.mjs'
import { validatedReleaseFiles } from './publish-windows-release.mjs'
import { packWindowsRelease } from './pack-windows-release.mjs'
import { packPortableExtractor } from './portable-extractor.mjs'
import { acceptWindows } from './lib/windows-stages.mjs'
import { createWindowsDeltas } from './windows-update-delta.mjs'
import { deltaBaseArchives } from './update-delta-bases.mjs'
import { githubUpdateManifestBytes, updateManifestName } from './github-update-manifest.mjs'
import { run, runNode, writeJSON, sha256File } from './lib/build-util.mjs'

const env=process.env,coreRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..')
assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'win32')
assert(['inner-request','outer-request','finalize'].includes(env.SIGNING_STAGE))
for(const key of ['SOURCE_RUN_ID','GITHUB_RUN_ID']) assert.match(env[key],/^[1-9][0-9]*$/)
assert.match(env.GITHUB_SHA,/^[a-f0-9]{40}$/)
const editionRoot=resolve(env.EDITION_ROOT),output=resolve(env.RUNNER_TEMP,'windows-signing-'+env.GITHUB_RUN_ID)
await mkdir(output,{recursive:false})
const stateRoot=join(output,'state'),github=signingGitHub(env.GITHUB_REPOSITORY,env.GITHUB_TOKEN)
const policy=await localSigningPolicy(editionRoot);assert(policy,'Source-pinned Windows signing policy required')
assert.deepEqual(await github.sourceJSON('edition/windows-signing.json',env.GITHUB_SHA),policy)
const source=await github.request(`/actions/runs/${env.SOURCE_RUN_ID}`)
assert.equal(source.repository.full_name.toLowerCase(),env.GITHUB_REPOSITORY.toLowerCase())
assert.equal(source.path,candidateWorkflow(env.GITHUB_REPOSITORY));assert.equal(source.event,'workflow_dispatch')
assert.equal(source.head_sha,env.GITHUB_SHA);assert.equal(source.status,'completed');assert.equal(source.conclusion,'success')
assert.equal((await run('git',['-C',editionRoot,'rev-parse','HEAD'],{capture:true})).stdout.trim(),env.GITHUB_SHA)
const coreCommit=(await run('git',['-C',coreRoot,'rev-parse','HEAD'],{capture:true})).stdout.trim()
assert.equal((await run('git',['-C',coreRoot,'status','--porcelain'],{capture:true})).stdout.trim(),'','Signing core must be clean')
const lock=await github.sourceJSON('core.lock.json',env.GITHUB_SHA,true)
if(lock){assert.equal(lock.repository.toLowerCase(),'https://github.com/ecnu/eduwork.git');assert.equal(lock.commit,coreCommit)}
else assert.equal(coreCommit,env.GITHUB_SHA)
const sourceArtifact=await github.artifact(env.SOURCE_RUN_ID,'windows-release')
const common={repository:env.GITHUB_REPOSITORY,editionCommit:env.GITHUB_SHA,coreCommit,sourceRun:env.SOURCE_RUN_ID,sourceArtifact,policySHA256:sha256(JSON.stringify(policy))}
let state,request,parentArtifact,parentRequestArtifact
if(env.SIGNING_STAGE==='inner-request'){
  assert(!env.PARENT_RUN_ID&&!env.SIGNING_RESPONSE,'Initial request cannot have a parent or response')
  await github.download(sourceArtifact,join(output,'source.zip'),join(stateRoot,'source'))
  const receipt=JSON.parse(await readFile(join(stateRoot,'source/release-receipt.json'),'utf8'))
  assert.equal(receipt.publication,'awaiting-windows-signing');assert.equal(receipt.passed,false)
  assert.equal(receipt.signingPolicySHA256,common.policySHA256);assert.equal(receipt.coreCommit,coreCommit)
  assert.equal(receipt.recipe,'pinned-source');assert.equal(receipt.checks.sourceSnapshot,'passed')
  await validatedReleaseFiles(join(stateRoot,'source'),{repository:env.GITHUB_REPOSITORY,version:receipt.version,commit:env.GITHUB_SHA,allowSigningPending:true})
  await cp(join(stateRoot,'source/RELEASE-NOTES.md'),join(stateRoot,'RELEASE-NOTES.md'))
  await unpackSafe(join(stateRoot,'source',receipt.asset.name),join(stateRoot,'payload'))
  await rm(join(stateRoot,'source'),{recursive:true})
  const payload=join(stateRoot,'payload',receipt.edition)
  await runNode(join(coreRoot,'scripts/verify-windows-release.mjs'),[payload,'--for-update'])
  const manifestBytes=await readFile(join(payload,'RELEASE-MANIFEST.json'))
  const manifest=JSON.parse(manifestBytes)
  assert.equal(manifest.version,receipt.version)
  const thirdParty=join(output,'third-party-pe.json')
  await signingTool('inventory',{root:payload,exclude:ownedWindowsFiles,output:thirdParty},join(output,'inventory'))
  state={schemaVersion:1,sourceReceipt:receipt,originalManifest:manifest,originalManifestSHA256:sha256(manifestBytes),thirdPartyPE:JSON.parse(await readFile(thirdParty,'utf8'))}
  request=await createSigningRequest({stage:'inner',policy,context:{...common,version:receipt.version,product:receipt.edition,distribution:receipt.distribution,requestRun:env.GITHUB_RUN_ID,parentRun:null},root:payload,work:join(output,'digest')})
}else{
  assert.match(env.PARENT_RUN_ID,/^[1-9][0-9]*$/);assert.notEqual(env.PARENT_RUN_ID,env.GITHUB_RUN_ID)
  assert(Buffer.byteLength(env.SIGNING_RESPONSE||'','utf8')<=60000)
  await github.signingRun(env.PARENT_RUN_ID,env.GITHUB_SHA)
  parentArtifact=await github.artifact(env.PARENT_RUN_ID,'windows-signing-state')
  parentRequestArtifact=await github.artifact(env.PARENT_RUN_ID,'windows-signing-request')
  await github.download(parentArtifact,join(output,'parent.zip'),stateRoot)
  state=JSON.parse(await readFile(join(stateRoot,'state.json'),'utf8'))
  const previous=JSON.parse(await readFile(join(stateRoot,'request.json'),'utf8'))
  const expectedStage=env.SIGNING_STAGE==='outer-request'?'inner':'outer'
  validateRequest(previous,{...common,requestRun:env.PARENT_RUN_ID,stage:expectedStage})
  assert.deepEqual(previous.policy,policy)
  await github.download(parentRequestArtifact,join(output,'parent-request.zip'),join(output,'parent-request'))
  assert.equal(requestHash(JSON.parse(await readFile(join(output,'parent-request/request.json'),'utf8'))),requestHash(previous))
  const response=JSON.parse(env.SIGNING_RESPONSE);validateResponse(response,previous)
  const record={request:previous,response,stateArtifact:parentArtifact,requestArtifact:parentRequestArtifact}
  const receipt=state.sourceReceipt,payload=join(stateRoot,'payload',receipt.edition)
  assert.equal(receipt.editionCommit,env.GITHUB_SHA);assert.equal(receipt.coreCommit,coreCommit)
  assert.equal(receipt.version,previous.context.version);assert.equal(receipt.edition,previous.context.product)
  if(env.SIGNING_STAGE==='outer-request'){
    state.inner=record
    state.innerFiles=await ingestSigningResponse({request:previous,response,root:payload,work:join(output,'ingest')})
    // Every untouched file must still match the original manifest before the
    // signed files are inventoried into a completely new release manifest.
    for(const file of state.originalManifest.files){
      if(!ownedWindowsFiles.includes(file.path)) assert.deepEqual(await fileIdentity(join(payload,file.path)),{bytes:file.bytes,sha256:file.sha256},`Unsigned file changed: ${file.path}`)
    }
    await rm(join(payload,'RELEASE-MANIFEST.json'))
    const signedArchive=join(stateRoot,'signed',receipt.asset.name)
    await packWindowsRelease({candidate:payload,output:signedArchive,forUpdate:true})
    state.prepared=await packPortableExtractor({archive:signedArchive,expectedSHA256:await sha256File(signedArchive),outputDirectory:join(stateRoot,'extractor'),deferPackaging:true})
    request=await createSigningRequest({stage:'outer',policy,context:{...previous.context,requestRun:env.GITHUB_RUN_ID,parentRun:env.PARENT_RUN_ID},root:join(stateRoot,'extractor'),work:join(output,'digest')})
    // The outer EXE already contains the exact new ZIP. Carry it once; rebuild
    // neither the ZIP nor any signed PE in the final phase.
    await rm(join(stateRoot,'payload'),{recursive:true})
    await rm(join(stateRoot,'signed'),{recursive:true})
  }else{
    state.outer=record
    const outerFiles=await ingestSigningResponse({request:previous,response,root:join(stateRoot,'extractor'),work:join(output,'ingest')})
    const signedArchive=join(stateRoot,'signed',receipt.asset.name),publish=join(output,'publish')
    await mkdir(dirname(signedArchive),{recursive:true})
    const {payloadOffset,payload:embedded}=state.prepared
    assert(Number.isSafeInteger(payloadOffset)&&payloadOffset>0)
    await pipeline(createReadStream(join(stateRoot,'extractor',`${receipt.edition}-Setup.exe`),{start:payloadOffset,end:payloadOffset+embedded.bytes-1}),createWriteStream(signedArchive,{flags:'wx'}))
    assert.equal(await sha256File(signedArchive),embedded.sha256,'Embedded signed archive differs')
    await writeFile(`${signedArchive}.sha256`,`${embedded.sha256}  ${receipt.asset.name}\n`)
    await mkdir(publish,{recursive:true});await mkdir(join(output,'desktop'),{recursive:true})
    await writeJSON(join(output,'desktop/package.json'),{output:signedArchive,sha256:await sha256File(signedArchive)})
    const workspace={resolvePath:path=>join(output,path),parameters:{edition:receipt.edition,development:false,forUpdate:true,verifySnapshot:true,verifyPublisherBootstrap:receipt.checks.publisherFirstLaunch==='passed'}}
    const checks=await acceptWindows({workspace,coreRoot,signedExtractor:{directory:join(stateRoot,'extractor'),prepared:state.prepared}})
    const innerFiles=await verifyOwnedFiles(join(output,'unpacked',receipt.edition),state.inner.request,join(output,'verify-inner'))
    assert.deepEqual(innerFiles,state.innerFiles,'Delivered inner signatures changed')
    const bases=join(output,'delta-bases')
    await runNode(join(coreRoot,'scripts/update-delta-bases.mjs'),[env.GITHUB_REPOSITORY,receipt.edition,receipt.version,'windows',bases])
    const deltas=await createWindowsDeltas({archive:signedArchive,bases:await deltaBaseArchives(bases,receipt.version),product:receipt.edition,version:receipt.version,output:publish})
    const signing={schemaVersion:1,kind:'eduwork-windows-detached-signing',policySHA256:common.policySHA256,sourceRun:env.SOURCE_RUN_ID,sourceArtifact,inner:state.inner,outer:state.outer,finalRun:env.GITHUB_RUN_ID,files:[...innerFiles,...outerFiles],originalManifestSHA256:state.originalManifestSHA256,preservedFiles:'passed',thirdPartyPE:state.thirdPartyPE}
    const completed={...receipt,passed:true,publication:'signed-and-verified',asset:checks.asset,portableExtractor:checks.portableExtractorAssets,deltas,checks:{sourceAndDependencies:receipt.checks.sourceAndDependencies,...checks,authenticode:'passed'},signing}
    delete completed.checks.asset;delete completed.checks.portableExtractorAssets
    validateSigningReceipt(completed,policy)
    await cp(signedArchive,join(publish,receipt.asset.name));await cp(`${signedArchive}.sha256`,join(publish,`${receipt.asset.name}.sha256`))
    await cp(join(output,'gui/extractor-publish'),publish,{recursive:true,errorOnExist:true})
    await cp(join(stateRoot,'RELEASE-NOTES.md'),join(publish,'RELEASE-NOTES.md'))
    await writeJSON(join(publish,'release-receipt.json'),completed)
    await writeFile(join(publish,updateManifestName),githubUpdateManifestBytes(completed,env.GITHUB_REPOSITORY))
    await validatedReleaseFiles(publish,{repository:env.GITHUB_REPOSITORY,version:receipt.version,commit:env.GITHUB_SHA,signingPolicy:policy})
    console.log(`Signed Windows release accepted: ${receipt.asset.name}`)
  }
}
if(request){
  await writeJSON(join(stateRoot,'state.json'),state);await writeJSON(join(stateRoot,'request.json'),request)
  await writeJSON(join(output,'request/request.json'),request)
  console.log(`Approved-source ${request.stage} request SHA256: ${requestHash(request)}`)
}
