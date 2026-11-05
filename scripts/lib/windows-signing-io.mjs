import assert from 'node:assert/strict'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { ZipReader } from './zip.mjs'
import { sha256File } from './build-util.mjs'
import { safePath, validatePolicy, validateSigningRun } from './windows-signing-protocol.mjs'

export const policyPath = 'edition/windows-signing.json'
export function candidateWorkflow(repository) {
  const paths={'ecnu/eduwork':'.github/workflows/desktop-candidates.yml','ecnu/eduwork-ecnu':'.github/workflows/development-windows.yml'}
  assert(paths[repository.toLowerCase()],'Unsupported signing repository')
  return paths[repository.toLowerCase()]
}
export async function localSigningPolicy(editionRoot) {
  const bytes = await readFile(join(editionRoot, policyPath)).catch(error => { if(error.code !== 'ENOENT') throw error; return null })
  if (!bytes) return null
  const policy = JSON.parse(bytes); validatePolicy(policy); return policy
}
export async function unpackSafe(archive, directory) {
  const zip = await ZipReader.open(archive), seen = new Set()
  let total = 0
  for (const entry of zip.entries) {
    const path = safePath(entry.name.replace(/\/$/, '')), key = path.toLowerCase()
    assert(!seen.has(key), 'Duplicate/case-colliding ZIP entry'); seen.add(key)
    const type = (entry.externalAttributes >>> 16) & 0xf000
    assert(type === 0 || type === (entry.isDirectory ? 0x4000 : 0x8000), 'ZIP links/devices forbidden')
    total += entry.uncompressedSize; assert(total < 16 * 1024 ** 3, 'Oversized signing artifact')
  }
  for (const entry of zip.entries) {
    const path = join(directory, entry.name)
    await mkdir(entry.isDirectory ? path : dirname(path), {recursive:true})
    if (!entry.isDirectory) await writeFile(path, zip.read(entry), {flag:'wx'})
  }
}
export function signingGitHub(repository, token) {
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  assert(token, 'GitHub read token required for provenance')
  const api = `https://api.github.com/repos/${repository}`
  const headers = {Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json', 'User-Agent':'EduWork-Windows-Signing', 'X-GitHub-Api-Version':'2022-11-28'}
  async function request(path, optional = false) {
    const response = await fetch(api + path, {headers})
    if (optional && response.status === 404) return null
    assert(response.ok, `GitHub HTTP ${response.status}: ${path}`)
    return response.json()
  }
  async function sourceJSON(path, commit, optional = false) {
    assert.match(commit, /^[a-f0-9]{40}$/); safePath(path)
    const entry = await request(`/contents/${path}?ref=${commit}`, optional)
    if (!entry) return null
    assert.equal(entry.type,'file'); assert.equal(entry.encoding,'base64')
    return JSON.parse(Buffer.from(entry.content,'base64').toString('utf8'))
  }
  async function artifact(runId, name) {
    assert.match(String(runId),/^[1-9][0-9]*$/)
    const result = await request(`/actions/runs/${runId}/artifacts?per_page=100`)
    assert(result.total_count <= 100, 'Ambiguous artifact pagination')
    const found = result.artifacts.filter(a=>a.name===name && !a.expired)
    assert.equal(found.length,1,`Missing/ambiguous artifact ${name}`)
    const a=found[0];assert.match(a.digest,/^sha256:[a-f0-9]{64}$/)
    assert.equal(String(a.workflow_run.id),String(runId))
    return {id:String(a.id),name:a.name,sha256:a.digest.slice(7),bytes:a.size_in_bytes}
  }
  async function download(identity, archive, directory) {
    const redirect = await fetch(`${api}/actions/artifacts/${identity.id}/zip`, {headers,redirect:'manual'})
    assert.equal(redirect.status,302)
    const location = new URL(redirect.headers.get('location')); assert.equal(location.protocol,'https:')
    const response = await fetch(location); assert(response.ok,`Artifact HTTP ${response.status}`)
    await mkdir(dirname(archive),{recursive:true})
    await pipeline(Readable.fromWeb(response.body),createWriteStream(archive,{flags:'wx'}))
    assert.equal((await lstat(archive)).size,identity.bytes)
    assert.equal(await sha256File(archive),identity.sha256,'Artifact ZIP digest mismatch')
    await unpackSafe(archive,directory)
  }
  async function signingRun(runId, editionCommit) {
    const run = await request(`/actions/runs/${runId}`)
    validateSigningRun(run,{repository,editionCommit,runId:String(runId)})
    return run
  }
  return {request,sourceJSON,artifact,download,signingRun}
}
