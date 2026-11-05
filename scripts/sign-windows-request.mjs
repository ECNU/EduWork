// Local hardware-key operation. All approval fields are mandatory; this script
// never accepts a digest in isolation or reads a PIN from an input/environment.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { parseArgs } from 'node:util'
import { validateRequest, validateResponse, requestHash } from './lib/windows-signing-protocol.mjs'
import { checkSigningPayload, signingTool } from './lib/windows-signing-operations.mjs'
import { signingGitHub, candidateWorkflow } from './lib/windows-signing-io.mjs'

const {values:v}=parseArgs({options:Object.fromEntries(['request','payload-root','output','repository','edition-commit','core-commit','source-run','request-run','request-sha256','policy-sha256','version'].map(name=>[name,{type:'string'}]))})
for(const name of ['request','payload-root','output','repository','edition-commit','core-commit','source-run','request-run','request-sha256','policy-sha256','version']) assert(v[name],`Missing --${name}`)
assert.equal(process.platform,'win32','Local signing requires Windows')
assert.notEqual(process.env.GITHUB_ACTIONS,'true','Use the local hardware provider')
const request=JSON.parse(await readFile(resolve(v.request),'utf8'))
validateRequest(request,{repository:v.repository,editionCommit:v['edition-commit'],coreCommit:v['core-commit'],sourceRun:v['source-run'],requestRun:v['request-run'],requestSHA256:v['request-sha256'],policySHA256:v['policy-sha256'],version:v.version})
const github=signingGitHub(v.repository,process.env.GITHUB_TOKEN)
await github.signingRun(v['request-run'],v['edition-commit'])
const source=await github.request(`/actions/runs/${v['source-run']}`)
assert.equal(source.repository.full_name.toLowerCase(),v.repository.toLowerCase());assert.equal(source.head_sha,v['edition-commit']);assert.equal(source.path,candidateWorkflow(v.repository));assert.equal(source.event,'workflow_dispatch');assert.equal(source.status,'completed');assert.equal(source.conclusion,'success')
assert.deepEqual(await github.artifact(v['source-run'],'windows-release'),request.context.sourceArtifact)
const output=resolve(v.output);await mkdir(output,{recursive:false})
const requestArtifact=await github.artifact(v['request-run'],'windows-signing-request')
await github.download(requestArtifact,join(output,'hosted-request.zip'),join(output,'hosted-request'))
assert.equal(requestHash(JSON.parse(await readFile(join(output,'hosted-request/request.json'),'utf8'))),requestHash(request),'Request does not belong to the approved run')
await checkSigningPayload(request,resolve(v['payload-root']),join(output,'regenerated'))
const response={schemaVersion:1,kind:'eduwork-windows-signing-response',requestSHA256:requestHash(request),stage:request.stage,sourceRun:request.context.sourceRun,requestRun:request.context.requestRun,entries:[]}
for(const entry of request.entries){
  const directory=join(output,'regenerated',entry.id)
  const digest=join(directory,`${basename(entry.path)}.dig`)
  await signingTool('sign',{digest,policy:request.policy},directory)
  response.entries.push({id:entry.id,signature:(await readFile(`${digest}.signed`,'utf8')).trim()})
}
validateResponse(response,request)
await writeFile(join(output,'response.json'),JSON.stringify(response),{flag:'wx'})
console.log(`Signed ${response.entries.length} approved ${response.stage} files. Response: ${join(output,'response.json')}`)
