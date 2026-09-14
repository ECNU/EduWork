import {readFile} from 'node:fs/promises'
import {relative,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {assertPublicText} from './public-policy.mjs'
import {auditDocument} from './document-policy.mjs'
const root=resolve('.'),files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))].map(p=>resolve(p))
const publicFiles=new Set(files.map(path=>relative(root,path).replaceAll('\\','/')))
let documents=0,examples=0,links=0
for(const path of files) {
  const file=relative(root,path).replaceAll('\\','/')
  assert.ok(!/(__pycache__|\.pyc$|\.lbug|(^|\/)\.env(\.|$)|\.tgz$|docs\/evidence)/.test(file),'Private/generated file: '+file)
  if(!/\.(js|jsx|ts|tsx|mjs|json|md|yml|py|txt|ps1)$/.test(file))continue
  const text=await readFile(path,'utf8')
  assertPublicText(text,file)
  if(file.endsWith('.md')){const result=auditDocument(text,file,publicFiles);documents++;examples+=result.examples;links+=result.links}
}
const pkg=JSON.parse(await readFile('package.json','utf8')),shared=JSON.parse(await readFile('packages/artifact-services/package.json','utf8'))
assert.equal(pkg.dependencies[shared.name],shared.version)
for(const manifest of [pkg,shared]) {
  assert.match(manifest.version,/^\d+\.\d+\.\d+(?:-dev\.\d{8}\.\d+)?$/)
  assert.equal(manifest.publishConfig.access,'public')
  assert.equal(manifest.repository.url,'git+https://github.com/ecnu/EduWork.git')
  for(const [name,version] of Object.entries(manifest.peerDependencies))if(name.startsWith('@deepseek-ai/dsh-'))assert.equal(version,'0.1.5-rc.1')
}
assert.ok((await readFile('THIRD_PARTY_LICENSES.txt','utf8')).includes('Apache License'))
console.log(`Public source audit passed (${files.length} files; no private history is part of this snapshot).`)
console.log(`Documentation audit passed (${documents} documents, ${examples} JSON examples, ${links} local links).`)
