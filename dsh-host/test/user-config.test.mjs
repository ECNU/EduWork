import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, renameSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadUserConfig } from '../user-config.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'eduwork-config-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, file: join(root, 'eduwork.jsonc') }
}
test('all shipped commented examples parse', () => {
  const examples = readdirSync(new URL('../../config/desktop/examples/', import.meta.url)).filter(name => name.endsWith('.jsonc')).map(name => 'examples/' + name)
  assert.ok(examples.includes('examples/organization.jsonc'))
  for (const name of ['eduwork.jsonc', ...examples]) {
    const file = new URL('../../config/desktop/' + name, import.meta.url)
    const config = loadUserConfig(fileURLToPath(file))
    assert.equal(config.organizations.length, ['eduwork.jsonc', 'examples/updates.jsonc', 'examples/media.jsonc'].includes(name) ? 0 : 1)
  }
})
test('GitHub and static update configuration reject ambiguous or credential-bearing sources',t=>{
 const {file}=fixture(t)
 for(const updates of [{provider:'github',repository:'ecnu/EduWork'},{provider:'disabled'},{provider:'static',manifestURL:'https://school.example/updates/stable/latest-windows-amd64.json'}]){
  writeFileSync(file,JSON.stringify({schemaVersion:1,updates}));assert.deepEqual(loadUserConfig(file).updates,updates)
 }
 for(const updates of [{provider:'github',repository:'https://github.com/ecnu/EduWork'},{provider:'static'},{provider:'github',manifestURL:'https://school.example/feed'},{provider:'github',repository:'ecnu/EduWork',token:'private-token'},{provider:'unknown'}]){
  writeFileSync(file,JSON.stringify({schemaVersion:1,updates}));assert.throws(()=>loadUserConfig(file))
 }
})
test('file changes are read on the next preparation, missing config remains identity-free', t => {
  const {file}=fixture(t)
  assert.equal(loadUserConfig(file).organizations.length, 0)
  writeFileSync(file, '// 注释\n{"schemaVersion":1,"product":{"name":"校园 A"},"organizations":[],}')
  const previous=loadUserConfig(file)
  writeFileSync(file, '{"schemaVersion":1,"product":{"name":"校园 B"},"desktop":{"closeAction":"exit"}}')
  assert.equal(loadUserConfig(file).product.name, '校园 B')
  assert.equal(previous.product.name, '校园 A')
  assert.equal(loadUserConfig(file).closeAction, 'exit')
})

test('optional vision assistance is file-owned and does not change native model capabilities', t => {
  const {file}=fixture(t)
  writeFileSync(file, '{"schemaVersion":1,"features":{"visionFallback":false}}')
  assert.equal(loadUserConfig(file).features.visionFallback,false)
  writeFileSync(file, '{"schemaVersion":1,"features":{"visionFallback":"false"}}')
  assert.throws(()=>loadUserConfig(file),/必须为 true 或 false/)
})

test('legacy child limits convert to totals without rewriting the config', t => {
  const {file}=fixture(t)
  writeFileSync(file, '{"schemaVersion":1,"features":{"maxParallelSubagents":2}}')
  assert.equal(loadUserConfig(file).features.maxParallelSubagents,2)
  assert.equal(loadUserConfig(file).features.maxConcurrentRequests,3)
  assert.equal(readFileSync(file,'utf8'),'{"schemaVersion":1,"features":{"maxParallelSubagents":2}}')
  for(const value of [0,-1,1.5,33,'2',null]) {
    writeFileSync(file, JSON.stringify({schemaVersion:1,features:{maxParallelSubagents:value}}))
    assert.throws(()=>loadUserConfig(file),/1–32/)
  }
})

test('total request budget is configurable and takes precedence over the legacy field', t => {
  const {file}=fixture(t)
  for(const value of [1,2,3,33,64]) {
    writeFileSync(file,JSON.stringify({schemaVersion:1,features:{maxConcurrentRequests:value,maxParallelSubagents:2}}))
    assert.equal(loadUserConfig(file).features.maxConcurrentRequests,value)
  }
  for(const value of [0,-1,1.5,65,'2',null]) {
    writeFileSync(file,JSON.stringify({schemaVersion:1,features:{maxConcurrentRequests:value}}))
    assert.throws(()=>loadUserConfig(file),/1–64/)
  }
})
test('relative logo survives moving configuration and malformed data reports file and line', t => {
  const {root,file}=fixture(t)
  mkdirSync(join(root,'assets'))
  writeFileSync(join(root,'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(file, '{"schemaVersion":1,"product":{"logoFile":"assets/logo.svg"}}')
  const image=loadUserConfig(file).product.logoUrl
  const moved=join(root,'中文 space');mkdirSync(moved)
  renameSync(join(root,'assets'),join(moved,'assets'));renameSync(file,join(moved,'eduwork.jsonc'))
  assert.equal(loadUserConfig(join(moved,'eduwork.jsonc')).product.logoUrl,image)
  writeFileSync(file, '{\n"schemaVersion":1,\n"organizations": [ }')
  assert.throws(()=>loadUserConfig(file), error=>error.message.includes(file)&&/第 3 行/.test(error.message))
})
test('typos, duplicate fields, credential-bearing top-level config and escaping logos are rejected without writing the source', t => {
  const {file}=fixture(t)
  for(const body of ['{"schemaVersion":1,"schemaVersion":1}','{"schemaVersion":1,"apiKey":"do-not-log"}','{"schemaVersion":1,"__proto__":{}}','{"schemaVersion":1,"desktop":{"closeAction":"typo"}}','{"schemaVersion":1,"product":{"logoFile":"../outside.png"}}']) {
    writeFileSync(file,body);assert.throws(()=>loadUserConfig(file));assert.equal(readFileSync(file,'utf8'),body)
  }
})


test('installed-plugin options accept JSON objects and reject malformed entries', t => {
  const {file}=fixture(t)
  for(const plugins of [[], {'Bad ID':{}}, {'example':null}, {'example':[]}]) {
    writeFileSync(file,JSON.stringify({schemaVersion:1,plugins}))
    assert.throws(()=>loadUserConfig(file))
  }
  const plugins={'example':{baseURL:'https://uat.example.test/v1',enabled:false}}
  writeFileSync(file,JSON.stringify({schemaVersion:1,plugins}))
  assert.deepEqual(JSON.parse(JSON.stringify(loadUserConfig(file).pluginConfig)),plugins)
})
