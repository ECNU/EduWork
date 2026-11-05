import assert from 'node:assert/strict'
import { validatePolicy, validateRequest, validateResponse, validateArtifact, ownedWindowsFiles, requestHash, sha256 } from './windows-signing-protocol.mjs'

export function validateSigningReceipt(receipt, policy) {
  assert(policy,'A signed release needs the source-pinned certificate policy');validatePolicy(policy)
  const signing=receipt.signing
  assert.equal(signing?.schemaVersion,1);assert.equal(signing.kind,'eduwork-windows-detached-signing')
  assert.equal(receipt.publication,'signed-and-verified');assert.equal(receipt.checks?.authenticode,'passed')
  assert.equal(signing.policySHA256,sha256(JSON.stringify(policy)))
  const shared={editionCommit:receipt.editionCommit,coreCommit:receipt.coreCommit,version:receipt.version,product:receipt.edition,sourceRun:signing.sourceRun,policySHA256:signing.policySHA256,sourceArtifact:signing.sourceArtifact}
  validateArtifact(signing.sourceArtifact);assert.equal(signing.sourceArtifact.name,'windows-release')
  for(const [stage,record] of [['inner',signing.inner],['outer',signing.outer]]){
    validateRequest(record.request,{...shared,stage});validateResponse(record.response,record.request)
    assert.deepEqual(record.request.policy,policy)
    validateArtifact(record.stateArtifact);assert.equal(record.stateArtifact.name,'windows-signing-state')
    validateArtifact(record.requestArtifact);assert.equal(record.requestArtifact.name,'windows-signing-request')
  }
  assert.equal(signing.outer.request.context.repository,signing.inner.request.context.repository)
  assert.equal(signing.outer.request.context.parentRun,signing.inner.request.context.requestRun)
  assert.match(signing.finalRun,/^[1-9][0-9]*$/)
  const runs=[signing.sourceRun,signing.inner.request.context.requestRun,signing.outer.request.context.requestRun,signing.finalRun]
  assert.equal(new Set(runs).size,4,'Signing phases must be separate runs')
  const paths=[...ownedWindowsFiles,`${receipt.edition}-Setup.exe`]
  assert.deepEqual(signing.files.map(x=>x.path).sort(),[...paths].sort())
  for(const file of signing.files){
    assert.equal(file.status,'Valid');assert.equal(file.thumbprint,policy.thumbprint);assert.equal(file.subject,policy.subject)
    assert.match(file.timestampThumbprint,/^[A-F0-9]{40}$/);assert.match(file.sha256,/^[a-f0-9]{64}$/)
    assert(Number.isSafeInteger(file.bytes)&&file.bytes>0)
    const request=file.path.endsWith('-Setup.exe')?signing.outer.request:signing.inner.request
    assert.equal(file.beforeSHA256,request.entries.find(e=>e.path===file.path).sha256)
    assert.equal(file.originalSHA256,request.entries.find(e=>e.path===file.path).inputSHA256)
  }
  assert.match(signing.originalManifestSHA256,/^[a-f0-9]{64}$/)
  assert.equal(signing.preservedFiles,'passed');assert(Array.isArray(signing.thirdPartyPE))
  for(const file of signing.thirdPartyPE){assert(['Valid','NotSigned'].includes(file.status));assert(!ownedWindowsFiles.includes(file.path));assert.match(file.sha256,/^[a-f0-9]{64}$/)}
  return signing
}

// Only three small provenance artifacts are fetched here. The Windows release
// ZIP is downloaded by the existing publisher with its independent digest gate.
export async function verifySigningChain({github,receipt,policy,sourceRun,finalRun,repository,root}) {
  const signing=validateSigningReceipt(receipt,policy)
  assert.equal(signing.sourceRun,String(sourceRun));assert.equal(signing.finalRun,String(finalRun))
  assert.equal(signing.inner.request.context.repository,repository)
  assert.deepEqual(await github.artifact(sourceRun,'windows-release'),signing.sourceArtifact)
  await github.signingRun(finalRun,receipt.editionCommit)
  const {readFile}=await import('node:fs/promises'),{join}=await import('node:path')
  for(const stage of ['inner','outer']){
    const record=signing[stage],run=record.request.context.requestRun
    await github.signingRun(run,receipt.editionCommit)
    assert.deepEqual(await github.artifact(run,'windows-signing-state'),record.stateArtifact)
    const identity=await github.artifact(run,'windows-signing-request')
    assert.deepEqual(identity,record.requestArtifact)
    const directory=join(root,stage)
    await github.download(identity,join(root,`${stage}.zip`),directory)
    assert.equal(requestHash(JSON.parse(await readFile(join(directory,'request.json'),'utf8'))),requestHash(record.request))
  }
}
