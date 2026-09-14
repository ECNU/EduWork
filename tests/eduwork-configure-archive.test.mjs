import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/configure-desktop-archive.ps1', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
test('configuration overlay preserves program bytes, inherits the CI channel and rejects a mismatched explicit channel', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork overlay 中文 '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const create = join(root, 'archive.ps1')
  await writeFile(create, 'param($Source,$Archive)\n[IO.Compression.ZipFile]::CreateFromDirectory($Source,$Archive)')
  const pwsh = (path,args) => execFileSync('pwsh', ['-NoProfile','-File',path,...args], { windowsHide:true, encoding:'utf8', stdio:'pipe' })
  for (const [version,policy] of [['0.3.6-dev.20260914.2','development'],['0.3.6','stable']]) {
    const directory=join(root,version), input=join(directory,'input'), archive=join(directory,'ci.zip')
    const files={
      'config/eduwork.jsonc':JSON.stringify({schemaVersion:1,organizations:[]}),
      'resources/app/eduwork.desktop.json':JSON.stringify({shell:'electron',productVersion:version,distribution:'eduwork'}),
      'resources/program.txt':'immutable synthetic program bytes',
    }
    for(const [path,value] of Object.entries(files)) {const target=join(input,'App',path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,value)}
    await writeFile(join(input,'App/RELEASE-MANIFEST.json'),JSON.stringify({schemaVersion:1,kind:'eduwork-portable-release',version,shell:'electron',distribution:'eduwork',files:Object.entries(files).map(([path,value])=>({path,bytes:Buffer.byteLength(value),sha256:hash(value)}))}))
    pwsh(create,[input,archive])
    const sourceHash=hash(await readFile(archive))
    const config=join(directory,'private.jsonc')
    const organization={schemaVersion:1,organizations:[{id:'example',oidc:{issuer:'https://identity.example.org',clientId:'synthetic-archive-client'}}]}
    for(const [label,updates] of [['inherited',undefined],['github',{provider:'github',repository:'ecnu/EduWork',defaultPolicy:policy}],['static',{provider:'static',manifestURL:'https://updates.example.org/latest.json',defaultPolicy:policy}],['disabled',{provider:'disabled'}]]) {
      await writeFile(config,JSON.stringify({...organization,...(updates?{updates}:{})}))
      const output=join(directory,label+'.zip')
      pwsh(script,['-Archive',archive,'-ExpectedSHA256',sourceHash,'-Config',config,'-Output',output])
      const receipt=JSON.parse(await readFile(output+'.receipt.json','utf8'))
      assert.equal(receipt.defaultPolicy,policy)
      assert.equal(receipt.sourceCIArchiveSHA256,sourceHash)
      assert.equal(receipt.programFilesUnchanged,true)
      assert.deepEqual(receipt.changedFiles,['config/eduwork.jsonc','RELEASE-MANIFEST.json'])
      assert.equal(hash(await readFile(output)),receipt.sha256)
      assert.equal(hash(await readFile(archive)),sourceHash,'Original CI archive must remain immutable')
    }
    await writeFile(config,JSON.stringify({...organization,updates:{provider:'github',repository:'ecnu/EduWork',defaultPolicy:policy==='stable'?'development':'stable'}}))
    assert.throws(()=>pwsh(script,['-Archive',archive,'-ExpectedSHA256',sourceHash,'-Config',config,'-Output',join(directory,'wrong.zip')]),/differs from the CI version channel/)
  }
})
