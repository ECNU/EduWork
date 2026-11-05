import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, X509Certificate, randomBytes } from 'node:crypto'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256, safePath, requestHash, validatePolicy, validateRequest, validateResponse, validateDigestBinding, validateSigningRun, ownedWindowsFiles } from '../scripts/lib/windows-signing-protocol.mjs'
import { candidateWorkflow, unpackSafe } from '../scripts/lib/windows-signing-io.mjs'
import { validateSigningReceipt, verifySigningChain } from '../scripts/lib/windows-signing-receipt.mjs'
import { validateReceipt } from '../scripts/publish-windows-release.mjs'
import { ZipWriter } from '../scripts/lib/zip.mjs'

// Synthetic ephemeral certificate and CMS. No institution identity, private-key
// fixture, token or external trust-store changes are involved in these tests.
function der(tag,...parts){
  const content=Buffer.concat(parts.map(p=>Buffer.isBuffer(p)?p:Buffer.from(p))),n=content.length
  const length=n<128?Buffer.from([n]):Buffer.from(n<=255?[0x81,n]:[0x82,n>>8,n&255])
  return Buffer.concat([Buffer.from([tag]),length,content])
}
const seq=(...a)=>der(0x30,...a),set=(...a)=>der(0x31,...a),oct=b=>der(4,b),oid=h=>der(6,Buffer.from(h,'hex'))
const shaAlg=seq(oid('608648016503040201'),der(5)),rsaAlg=seq(oid('2a864886f70d010101'),der(5)),sigAlg=seq(oid('2a864886f70d01010b'),der(5))
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:3072})
const name=seq(set(seq(oid('550403'),der(12,'Synthetic Test Publisher')))),serial=der(2,[1])
const tbs=seq(der(0xa0,der(2,[2])),serial,sigAlg,name,seq(der(23,'250101000000Z'),der(23,'350101000000Z')),name,publicKey.export({format:'der',type:'spki'}))
const certificate=seq(tbs,sigAlg,der(3,Buffer.from([0]),sign('sha256',tbs,privateKey)))
const cert=new X509Certificate(certificate)
const policy={schemaVersion:1,required:true,certificate:certificate.toString('base64'),thumbprint:cert.fingerprint.replaceAll(':',''),subject:'CN=Synthetic Test Publisher',timestampURL:'https://timestamp.example.test/rfc3161'}
const artifact=name=>({id:'123',name,sha256:'e'.repeat(64),bytes:100})
function entry(path,nonce=''){
  const indirect=seq(seq(oid('2b06010401823702010f')),seq(shaAlg,oct(Buffer.from(sha256(path+nonce),'hex'))))
  // Authenticode hashes the contents of SpcIndirectDataContent, without its SEQUENCE header.
  const indirectContent=indirect.subarray(indirect[1]<128?2:4)
  const attributes=set(seq(oid('2a864886f70d010904'),set(oct(Buffer.from(sha256(indirectContent),'hex')))))
  const digest=Buffer.from(sha256(attributes),'hex'),tagged=Buffer.from(attributes);tagged[0]=0xa0
  const signer=seq(der(2,[1]),seq(name,serial),shaAlg,tagged,rsaAlg,oct(digest))
  const pkcs7=seq(oid('2a864886f70d010702'),der(0xa0,seq(der(2,[1]),set(shaAlg),seq(oid('2b060104018237020104'),der(0xa0,indirect)),der(0xa0,certificate),set(signer))))
  return {id:sha256(path).slice(0,32),path,bytes:100,sha256:sha256('unsigned'+path+nonce),digest:digest.toString('base64'),pkcs7:pkcs7.toString('base64'),pkcs7SHA256:sha256(pkcs7)}
}
function request(stage='inner'){
  return {schemaVersion:1,kind:'eduwork-windows-signing-request',stage,policy:structuredClone(policy),context:{repository:'ECNU/EduWork',editionCommit:'a'.repeat(40),coreCommit:'a'.repeat(40),version:'0.4.11',product:'EduWork',distribution:'eduwork',sourceRun:'1',requestRun:stage==='inner'?'2':'3',parentRun:stage==='inner'?null:'2',sourceArtifact:artifact('windows-release'),policySHA256:sha256(JSON.stringify(policy))},entries:(stage==='inner'?ownedWindowsFiles:['EduWork-Setup.exe']).map(p=>entry(p))}
}
function response(req){return {schemaVersion:1,kind:'eduwork-windows-signing-response',requestSHA256:requestHash(req),stage:req.stage,sourceRun:req.context.sourceRun,requestRun:req.context.requestRun,entries:req.entries.map(e=>({id:e.id,signature:sign('sha256',validateDigestBinding(e,policy).attributes,privateKey).toString('base64')}))}}
function signedReceipt(){
  const inner=request(),outer=request('outer'),record=req=>({request:req,response:response(req),stateArtifact:artifact('windows-signing-state'),requestArtifact:artifact('windows-signing-request')})
  const files=[...inner.entries,...outer.entries].map(e=>({path:e.path,beforeSHA256:e.sha256,sha256:sha256('signed'+e.path),bytes:500,status:'Valid',thumbprint:policy.thumbprint,subject:policy.subject,timestampThumbprint:'F'.repeat(40)}))
  const asset=name=>({name,bytes:100,sha256:'b'.repeat(64)})
  return {schemaVersion:1,kind:'eduwork-windows-release',validationProfile:'ci-build-launch-and-extract-v2',shell:'electron',platform:'windows-x64',passed:true,automaticUpdates:true,releaseNotes:{approved:true,sha256:'c'.repeat(64)},asset:asset('EduWork-0.4.11-windows-x64-electron.zip'),portableExtractor:{asset:asset('EduWork-0.4.11-windows-x64-setup.zip'),receipt:asset('EduWork-0.4.11-windows-x64-setup.zip.json')},edition:'EduWork',version:'0.4.11',editionCommit:'a'.repeat(40),coreCommit:'a'.repeat(40),publication:'signed-and-verified',checks:{...Object.fromEntries(['sourceAndDependencies','desktopLaunch','archiveManifest','nativeRuntimes','portableExtractor','updateContract'].map(key=>[key,'passed'])),authenticode:'passed'},signing:{schemaVersion:1,kind:'eduwork-windows-detached-signing',policySHA256:sha256(JSON.stringify(policy)),sourceRun:'1',sourceArtifact:artifact('windows-release'),inner:record(inner),outer:record(outer),finalRun:'4',files,originalManifestSHA256:'a'.repeat(64),preservedFiles:'passed',thirdPartyPE:[]}}
}
test('policy, unsigned CMS and RSA response form a verified synthetic round trip',()=>{
  validatePolicy(policy)
  for(const stage of ['inner','outer']){const req=request(stage);validateRequest(req);validateResponse(response(req),req)}
  validateSigningReceipt(signedReceipt(),policy)
})
test('rejects unexpected paths, stages, fields and signing identities',()=>{
  const mutations=[r=>r.entries.push(r.entries[0]),r=>r.entries[0].path='../other.exe',r=>r.entries[0].path='resources/node.exe',r=>r.context.editionCommit='b'.repeat(39),r=>r.context.parentRun='9',r=>r.policy.required=false,r=>r.policy.thumbprint='0'.repeat(40),r=>r.policy.extra='ignore',r=>r.entries[0].extra=true,r=>r.entries[1]=r.entries[0]]
  for(const mutate of mutations){const req=request();mutate(req);assert.throws(()=>validateRequest(req))}
  assert.throws(()=>validateRequest(request(),{requestSHA256:'0'.repeat(64)}))
  assert.throws(()=>validateRequest(request(),{coreCommit:'b'.repeat(40)}))
})
test('digest/envelope/certificate swaps fail before hardware signing',()=>{
  const original=request().entries[0]
  for(const changed of [{digest:randomBytes(32).toString('base64')},{pkcs7:Buffer.from('invalid').toString('base64')},{pkcs7:entry('other.exe').pkcs7},{pkcs7:original.pkcs7.slice(4)}]) assert.throws(()=>validateDigestBinding({...original,...changed},policy))
  assert.throws(()=>validateDigestBinding(original,{...policy,certificate:Buffer.from('wrong').toString('base64')}))
})
test('responses reject replay, omissions, duplicate entries, bogus signatures and extra fields',()=>{
  const req=request()
  const mutations=[r=>r.requestSHA256='0'.repeat(64),r=>r.requestRun='999',r=>r.sourceRun='999',r=>r.stage='outer',r=>r.entries.pop(),r=>r.entries.push(r.entries[0]),r=>r.entries[1]=r.entries[0],r=>r.entries[0].signature=randomBytes(384).toString('base64'),r=>r.entries[0].signature+='\n',r=>r.entries[0].id='bogus',r=>r.PIN='forbidden']
  for(const mutate of mutations){const result=response(req);mutate(result);assert.throws(()=>validateResponse(result,req))}
  assert.throws(()=>validateResponse(response(req),request('outer')))
})
test('final receipt requires both rounds, five signatures, timestamps and preserved bytes',()=>{
  const mutations=[r=>delete r.signing,r=>r.publication='awaiting-windows-signing',r=>r.checks.authenticode='skipped',r=>r.signing.outer.request.context.parentRun='12',r=>r.signing.files.pop(),r=>r.signing.files[0].timestampThumbprint='',r=>r.signing.files[0].thumbprint='0'.repeat(40),r=>r.signing.files[0].beforeSHA256='b'.repeat(64),r=>r.signing.finalRun='2',r=>r.signing.preservedFiles='skipped',r=>r.signing.thirdPartyPE=[{path:'x.dll',sha256:'a'.repeat(64),status:'HashMismatch'}]]
  for(const mutate of mutations){const receipt=signedReceipt();mutate(receipt);assert.throws(()=>validateSigningReceipt(receipt,policy))}
  assert.throws(()=>validateSigningReceipt(signedReceipt(),null))
})
test('source workflow allowlist distinguishes institution and public runs',()=>{
  assert.equal(candidateWorkflow('ECNU/EduWork'),'.github/workflows/desktop-candidates.yml')
  assert.equal(candidateWorkflow('ECNU/EduWork-ECNU'),'.github/workflows/development-windows.yml')
  assert.throws(()=>candidateWorkflow('other/repository'))
  const run={id:2,repository:{full_name:'ECNU/EduWork'},path:'.github/workflows/windows-signing.yml',event:'workflow_dispatch',head_sha:'a'.repeat(40),status:'completed',conclusion:'success'}
  const expected={repository:'ECNU/EduWork',editionCommit:run.head_sha,runId:'2'}
  validateSigningRun(run,expected)
  for(const changed of [{head_sha:'b'.repeat(40)},{path:'.github/workflows/development-windows.yml'},{event:'pull_request'},{id:3},{conclusion:'failure'},{status:'in_progress'}]) assert.throws(()=>validateSigningRun({...run,...changed},expected))
})
test('publisher independently fetches the two request artifacts and validates the full run chain',async t=>{
  const root=await mkdtemp(join(tmpdir(),'eduwork-signing-chain-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const receipt=signedReceipt(),runs=[]
  let corruptArtifact=false,corruptRequest=false
  const github={
    async signingRun(id,commit){runs.push(id);assert.equal(commit,receipt.editionCommit)},
    async artifact(id,name){return {...artifact(name),...(corruptArtifact?{sha256:'0'.repeat(64)}:{})}},
    async download(identity,archive,directory){await mkdir(directory,{recursive:true});const req=receipt.signing[directory.endsWith('inner')?'inner':'outer'].request;await writeFile(join(directory,'request.json'),JSON.stringify(corruptRequest?{...req,stage:'swapped'}:req))},
  }
  const options={github,receipt,policy,sourceRun:'1',finalRun:'4',repository:'ECNU/EduWork',root}
  await verifySigningChain(options);assert.deepEqual(runs,['4','2','3'])
  await assert.rejects(verifySigningChain({...options,sourceRun:'9'}))
  await assert.rejects(verifySigningChain({...options,finalRun:'9'}))
  await assert.rejects(verifySigningChain({...options,repository:'ECNU/EduWork-ECNU'}))
  corruptArtifact=true;await assert.rejects(verifySigningChain(options));corruptArtifact=false
  corruptRequest=true;await assert.rejects(verifySigningChain(options))
})
test('pending original receipt is rejected by ordinary publication',()=>{
  const context={repository:'ECNU/EduWork',version:'0.4.11',commit:'a'.repeat(40),signingPolicy:policy}
  const signed=signedReceipt();validateReceipt(signed,context)
  const pending={...structuredClone(signed),passed:false,publication:'awaiting-windows-signing'};delete pending.signing
  validateReceipt(pending,{...context,allowSigningPending:true})
  assert.throws(()=>validateReceipt(pending,context))
  assert.throws(()=>validateReceipt({...pending,passed:true},context),/signing is incomplete/)
  delete signed.signing;assert.throws(()=>validateReceipt(signed,context))
})
test('artifact extraction refuses traversal, Windows aliases and case collisions',async t=>{
  for(const path of ['../a','a/../../b','C:/x','/x','a\\b','NUL.txt','a/COM1','a./b','a /b','a:b','a?b']) assert.throws(()=>safePath(path))
  const root=await mkdtemp(join(tmpdir(),'eduwork-signing-zip-'));t.after(()=>rm(root,{recursive:true,force:true}))
  for(const [i,names] of [['a',['../escape']],['b',['a','A']],['c',['safe/file.txt']]]){
    const archive=join(root,i+'.zip'),zip=await ZipWriter.create(archive)
    for(const name of names) await zip.addEntry(name,Buffer.from('synthetic'))
    await zip.close()
    if(i==='c'){await unpackSafe(archive,join(root,i));assert.equal(await readFile(join(root,i,'safe/file.txt'),'utf8'),'synthetic')}
    else await assert.rejects(unpackSafe(archive,join(root,i)))
  }
})
