import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, lstat, copyFile } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, sha256File, writeJSON } from './build-util.mjs'
import { sha256, base64, ownedWindowsFiles, validateRequest, validateResponse, validateDigestBinding } from './windows-signing-protocol.mjs'

const helper = fileURLToPath(new URL('../windows-signing-tool.ps1',import.meta.url))
export async function signingTool(mode, job, directory) {
  await mkdir(directory,{recursive:true})
  const path=join(directory,`${mode}.job.json`)
  await writeJSON(path,job)
  await run('pwsh',['-NoProfile','-File',helper,'-Mode',mode,'-Job',path])
}
export async function fileIdentity(path) {
  const info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink(),'Signing target must be a regular file')
  return {bytes:info.size,sha256:await sha256File(path)}
}
async function digestFor(file, policy, directory) {
  await mkdir(directory,{recursive:true})
  const certificate=join(directory,'publisher.cer')
  await writeFile(certificate,base64(policy.certificate))
  await signingTool('digest',{file,policy,directory,certificate},directory)
  const digest=(await readFile(join(directory,`${basename(file)}.dig`),'utf8')).trim()
  const pkcs7=(await readFile(join(directory,`${basename(file)}.p7u`))).toString('base64')
  return {digest,pkcs7,pkcs7SHA256:sha256(base64(pkcs7))}
}
export async function createSigningRequest({stage,context,policy,root,work}) {
  const paths=stage==='inner'?ownedWindowsFiles:[`${context.product}-Setup.exe`],entries=[]
  for(const path of paths){
    const id=sha256(path).slice(0,32),file=join(root,path),identity=await fileIdentity(file)
    const generated=await digestFor(file,policy,join(work,id))
    // SignTool /dg may align or rewrite the unsigned PE certificate area.
    // Carry those exact emitted bytes into /di and retain the original hash.
    entries.push({id,path,inputBytes:identity.bytes,inputSHA256:identity.sha256,...await fileIdentity(file),...generated})
  }
  return validateRequest({schemaVersion:1,kind:'eduwork-windows-signing-request',stage,context,policy,entries})
}
// Recompute the digest from the actual PE bytes before using a hardware key.
// Certificate-chain packing may vary across machines; compare the signed
// attributes and indirect PE digest instead of the unsigned envelope bytes.
export async function checkSigningPayload(request,root,work){
  validateRequest(request)
  for(const entry of request.entries){
    const file=join(root,entry.path)
    assert.deepEqual(await fileIdentity(file),{bytes:entry.bytes,sha256:entry.sha256},`Changed signing target ${entry.path}`)
    const directory=join(work,entry.id)
    await mkdir(directory,{recursive:true})
    const copy=join(directory,basename(file));await copyFile(file,copy)
    const generated=await digestFor(copy,request.policy,directory)
    assert.equal(generated.digest,entry.digest,'Locally regenerated digest differs')
    const originalBinding=validateDigestBinding(entry,request.policy),localBinding=validateDigestBinding(generated,request.policy)
    assert(originalBinding.attributes.equals(localBinding.attributes))
    assert.equal(originalBinding.authenticodeSHA256,localBinding.authenticodeSHA256)
    assert.deepEqual(await fileIdentity(file),{bytes:entry.bytes,sha256:entry.sha256})
  }
}
export async function ingestSigningResponse({request,response,root,work}){
  validateResponse(response,request)
  const files=[]
  for(const entry of request.entries){
    const file=join(root,entry.path),directory=join(work,entry.id)
    assert.deepEqual(await fileIdentity(file),{bytes:entry.bytes,sha256:entry.sha256},'Unsigned bytes changed')
    await mkdir(directory,{recursive:true})
    await writeFile(join(directory,`${basename(file)}.dig`),entry.digest)
    await writeFile(join(directory,`${basename(file)}.p7u`),base64(entry.pkcs7))
    await writeFile(join(directory,`${basename(file)}.dig.signed`),response.entries.find(e=>e.id===entry.id).signature)
    const output=join(directory,'verification.json')
    await signingTool('ingest',{file,policy:request.policy,directory,output},directory)
    const verified=JSON.parse(await readFile(output,'utf8'))
    assert.equal(verified.sha256,await sha256File(file))
    files.push({path:entry.path,originalSHA256:entry.inputSHA256,beforeSHA256:entry.sha256,...verified})
  }
  return files
}
export async function verifyOwnedFiles(root,request,work){
  const files=[]
  for(const entry of request.entries){
    const output=join(work,entry.id,'verification.json')
    await signingTool('verify',{file:join(root,entry.path),policy:request.policy,output},dirname(output))
    files.push({path:entry.path,originalSHA256:entry.inputSHA256,beforeSHA256:entry.sha256,...JSON.parse(await readFile(output,'utf8'))})
  }
  return files
}
