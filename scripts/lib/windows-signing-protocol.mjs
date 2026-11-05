import assert from 'node:assert/strict'
import { createHash, X509Certificate, verify, constants } from 'node:crypto'

export const signingWorkflow = '.github/workflows/windows-signing.yml'
export const ownedWindowsFiles = Object.freeze(['ChatECNU-Work.exe', 'EduWork.exe', 'EduWork-Electron.exe', 'resources/update/EduWork-Updater.exe'])
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const requestHash = request => sha256(JSON.stringify(request))
const hash = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}$/, run = /^[1-9][0-9]*$/
function keys(value, expected) { assert(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'Unexpected protocol fields') }
export function safePath(value) {
  assert.equal(typeof value, 'string')
  assert(value.length > 0 && value.length < 240 && !/[\\:*?"<>|\x00-\x1f]/.test(value) && !value.startsWith('/'))
  assert(value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)), 'Unsafe signing path')
  assert(value.split('/').every(part => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Windows device path forbidden')
  return value
}
export function base64(value, max = 32768) {
  assert.equal(typeof value, 'string'); assert(value.length > 0 && value.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(value))
  const data = Buffer.from(value, 'base64'); assert.equal(data.toString('base64'), value, 'Noncanonical base64'); return data
}
export function validatePolicy(policy) {
  keys(policy, ['schemaVersion','required','certificate','thumbprint','subject','timestampURL'])
  assert.equal(policy.schemaVersion, 1); assert.equal(policy.required, true)
  const cert = new X509Certificate(base64(policy.certificate, 16384))
  assert.equal(cert.fingerprint.replaceAll(':',''), policy.thumbprint)
  assert.match(policy.thumbprint, /^[A-F0-9]{40}$/); assert.equal(typeof policy.subject,'string'); assert(policy.subject.length > 0)
  const tsa = new URL(policy.timestampURL); assert(['http:','https:'].includes(tsa.protocol) && !tsa.username && !tsa.password)
  assert.equal(cert.publicKey.asymmetricKeyType, 'rsa', 'Detached signing currently requires RSA')
  assert(cert.publicKey.asymmetricKeyDetails.modulusLength >= 3072)
  return cert
}
export function validateArtifact(artifact) {
  keys(artifact, ['id','name','sha256','bytes']); assert.match(artifact.id,run); assert.match(artifact.sha256,hash)
  assert.match(artifact.name,/^[a-z][a-z0-9-]+$/); assert(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0)
}
export function validateContext(context) {
  keys(context,['repository','editionCommit','coreCommit','version','product','distribution','sourceRun','requestRun','parentRun','sourceArtifact','policySHA256'])
  assert.match(context.repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  for(const key of ['editionCommit','coreCommit']) assert.match(context[key],commit)
  for(const key of ['sourceRun','requestRun']) assert.match(context[key],run)
  assert(context.parentRun === null || run.test(context.parentRun))
  assert.match(context.version,/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
  assert(['EduWork','EduWork-ECNU'].includes(context.product))
  assert.equal(context.distribution,context.product === 'EduWork' ? 'eduwork' : 'eduwork-chatecnu')
  validateArtifact(context.sourceArtifact); assert.match(context.policySHA256,hash)
}
export function validateRequest(request, expected = {}) {
  keys(request,['schemaVersion','kind','stage','context','policy','entries'])
  assert.equal(request.schemaVersion,1); assert.equal(request.kind,'eduwork-windows-signing-request')
  assert(['inner','outer'].includes(request.stage)); validateContext(request.context)
  validatePolicy(request.policy); assert.equal(sha256(JSON.stringify(request.policy)),request.context.policySHA256)
  for(const [key,value] of Object.entries(expected)) {
    if(key === 'requestSHA256') assert.equal(requestHash(request),value,'Unapproved request')
    else if(key === 'stage') assert.equal(request.stage,value)
    else assert.deepEqual(request.context[key],value,`Unapproved ${key}`)
  }
  const paths=request.stage === 'inner' ? ownedWindowsFiles : [`${request.context.product}-Setup.exe`]
  assert(Array.isArray(request.entries)); assert.equal(request.entries.length,paths.length)
  const seen=new Set()
  for(const entry of request.entries) {
    keys(entry,['id','path','bytes','sha256','digest','pkcs7','pkcs7SHA256'])
    safePath(entry.path); assert(paths.includes(entry.path)); assert(!seen.has(entry.path),'Duplicate signing target');seen.add(entry.path)
    assert.equal(entry.id,sha256(entry.path).slice(0,32)); assert.match(entry.sha256,hash)
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes>0)
    assert.equal(base64(entry.digest).length,32); assert.equal(sha256(base64(entry.pkcs7)),entry.pkcs7SHA256)
    validateDigestBinding(entry,request.policy)
  }
  assert.equal(request.stage === 'inner',request.context.parentRun === null,'Invalid signing stage parent')
  return request
}

// Strict bounded DER navigation for the SignTool unsigned SignedData envelope.
// It does not validate a certificate chain: SignTool does that after ingestion.
export function validateDigestBinding(entry, policy) {
  const data=base64(entry.pkcs7), digest=base64(entry.digest)
  function tlv(offset,end=data.length){
    const start=offset,tag=data[offset++];let length=data[offset++]
    assert(Number.isInteger(tag)&&Number.isInteger(length),'Truncated DER')
    if(length&128){const n=length&127;assert(n>0&&n<=4&&offset+n<=end);assert(data[offset]!==0);length=0;for(let i=0;i<n;i++)length=length*256+data[offset++];assert(length>=128)}
    assert(offset+length<=end);return {tag,start,content:offset,end:offset+length,raw:data.subarray(start,offset+length),value:data.subarray(offset,offset+length)}
  }
  function children(item){const a=[];let p=item.content;while(p<item.end){assert(a.length<128);const c=tlv(p,item.end);a.push(c);p=c.end}return a}
  const root=tlv(0);assert.equal(root.tag,48);assert.equal(root.end,data.length)
  const info=children(root);assert.equal(info.length,2);assert.equal(info[0].value.toString('hex'),'2a864886f70d010702')
  const sd=children(children(info[1])[0]); const signers=children(sd.at(-1));assert.equal(signers.length,1)
  const signer=children(signers[0]);assert.equal(signer.length,6);assert.equal(signer[3].tag,0xa0)
  assert.equal(children(signer[2])[0].value.toString('hex'),'608648016503040201')
  const attrs=Buffer.from(signer[3].raw);attrs[0]=0x31
  assert.equal(sha256(attrs),digest.toString('hex'),'DIG differs from signed attributes')
  assert.equal(signer[5].tag,4);assert(signer[5].value.equals(digest),'PKCS7 digest placeholder differs')
  const content=children(sd[2]);assert.equal(content[0].value.toString('hex'),'2b060104018237020104')
  const indirect=children(content[1])[0]
  const attributes=children(signer[3]).map(children)
  const message=attributes.filter(x=>x[0].value.toString('hex')==='2a864886f70d010904');assert.equal(message.length,1)
  assert.equal(children(message[0][1])[0].value.toString('hex'),sha256(indirect.value),'CMS does not bind PE content')
  const certificateBytes=base64(policy.certificate)
  const certificates=sd.find((item,index)=>index>2 && item.tag===0xa0);assert(certificates)
  assert.equal(children(certificates).filter(item=>item.raw.equals(certificateBytes)).length,1,'Expected certificate absent/duplicated')
  // Match SignerIdentifier issuer+serial with the pinned leaf certificate.
  const certOffset=data.indexOf(certificateBytes,certificates.content);assert(certOffset>=0)
  const tbs=children(children(tlv(certOffset))[0]);const version=tbs[0].tag===0xa0?1:0
  const sid=children(signer[1]);assert.equal(sid.length,2)
  assert(sid[1].value.equals(tbs[version].value) && sid[0].raw.equals(tbs[version+2].raw),'PKCS7 selects a different signer')
  return {attributes:attrs,authenticodeSHA256:children(children(indirect).at(-1))[1].value.toString('hex')}
}
export function validateResponse(response, request) {
  validateRequest(request)
  keys(response,['schemaVersion','kind','requestSHA256','stage','sourceRun','requestRun','entries'])
  assert.equal(response.schemaVersion,1);assert.equal(response.kind,'eduwork-windows-signing-response')
  assert.equal(response.requestSHA256,requestHash(request));assert.equal(response.stage,request.stage)
  assert.equal(response.sourceRun,request.context.sourceRun);assert.equal(response.requestRun,request.context.requestRun)
  assert(Array.isArray(response.entries));assert.equal(response.entries.length,request.entries.length)
  const cert=validatePolicy(request.policy),seen=new Set()
  for(const item of response.entries){
    keys(item,['id','signature']);assert(!seen.has(item.id),'Duplicate signature');seen.add(item.id)
    const entry=request.entries.find(e=>e.id===item.id);assert(entry,'Unknown signature entry')
    const {attributes}=validateDigestBinding(entry,request.policy)
    assert(verify('sha256',attributes,{key:cert.publicKey,padding:constants.RSA_PKCS1_PADDING},base64(item.signature,2048)),'Invalid RSA digest signature')
  }
  assert(Buffer.byteLength(JSON.stringify(response),'utf8')<=60000,'Response exceeds dispatch budget')
  return response
}
export function validateSigningRun(runObject, expected) {
  assert.equal(runObject.repository.full_name.toLowerCase(),expected.repository.toLowerCase())
  assert.equal(runObject.path,signingWorkflow);assert.equal(runObject.event,'workflow_dispatch')
  assert.equal(runObject.head_sha,expected.editionCommit);assert.equal(runObject.status,'completed');assert.equal(runObject.conclusion,'success')
  assert.equal(String(runObject.id),expected.runId)
}
