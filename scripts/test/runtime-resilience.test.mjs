import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { cp, mkdtemp, readFile, writeFile, mkdir, symlink, rm, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { adaptNativeBootTolerance, adaptNativeImageLimit, adaptNativeSessionIsolation, patchRuntimeResilience, runtimeResiliencePatches } from '../patch-runtime-resilience-runtime.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME

// Gateway image count limit
const stub = 'const IMAGE_OFFLOAD_REQUIRED_CODE = "IMAGE_OFFLOAD_REQUIRED";\nfunction mapStopReason(message, contextWindow) {\n\treturn { kind: "stop" };\n}\n'
const loadMap = source => new Function(`${source};return mapStopReason`)()
const error = text => ({ stopReason: 'error', errorMessage: text, content: [] })
test('gateway image count limit asks for the excess oldest images to be offloaded', () => {
  const map = loadMap(adaptNativeImageLimit(stub))
  const text = '400: {"message":"litellm.BadRequestError: OpenAIException - Invalid multimodal request: invalid media request for model qwen3_vl: model spec qwen3_vl supports at most 10 image inputs; got 11No fallback"}'
  assert.deepEqual(map(error(text), 1000).failure.code, 'IMAGE_OFFLOAD_REQUIRED')
  assert.equal(map(error(text), 1000).failure.offloadImages, 1)
})
test('other errors keep their mapping', () => {
  const map = loadMap(adaptNativeImageLimit(stub))
  assert.deepEqual(map(error('rate limited'), 1000), { kind: 'stop' })
  assert.deepEqual(map({ stopReason: 'stop', content: [{}] }, 1000), { kind: 'stop' })
})
test('changed upstream adapter is rejected', () => {
  assert.throws(() => adaptNativeImageLimit('changed'), /anchor changed/)
})

// Web boot tolerance
const audit = 'function eM(e,n){const o=[];for(const s of e)o.push(s);if(o.length>0)throw new Error(`web boot: ${String(o.length)} entries did not activate\n${o.join(`\n`)}`)}'
const run = (source, entries) => {
  const shown = [], logged = []
  const document = { createElement: () => ({ setAttribute() {}, style: {}, remove() {} }), body: { appendChild: d => shown.push(d.textContent) } }
  const fn = new Function('navigator', 'document', 'console', `${source};return eM`)({ language: 'zh-CN' }, document, { error: m => logged.push(String(m)) })
  return { call: () => fn(entries), shown, logged }
}
test('imported plugin failures are skipped with a notice', () => {
  const r = run(adaptNativeBootTolerance(audit), ['user-plugin: failed', '@x/y: pending (waiting for service: z)'])
  assert.doesNotThrow(r.call)
  assert.equal(r.shown.length, 1)
  assert.match(r.shown[0], /user-plugin、@x\/y/)
  assert.match(r.logged[0], /skipped entries/)
})
test('DSH package failures still reject boot', () => {
  const r = run(adaptNativeBootTolerance(audit), ['@deepseek-ai/dsh-client-chat: failed', 'user-plugin: failed'])
  assert.throws(r.call, /web boot: 2 entries did not activate/)
})
test('healthy boot shows nothing', () => {
  const r = run(adaptNativeBootTolerance(audit), [])
  assert.doesNotThrow(r.call)
  assert.equal(r.shown.length, 0)
})
test('changed upstream audit is rejected', () => {
  assert.throws(() => adaptNativeBootTolerance('changed'), /anchor changed/)
})

// Runtime steps
test('runtime steps pin the reviewed inputs and record each patched file', { skip: !runtime }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'eduwork-runtime-resilience-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const modules = join(temp, 'node_modules')
  for (const { package: name } of Object.values(runtimeResiliencePatches)) await cp(join(runtime, 'node_modules', name), join(modules, name), { recursive: true })
  const records = await patchRuntimeResilience(modules)
  assert.deepEqual(records.map(row => row.id), Object.values(runtimeResiliencePatches).map(patch => patch.id))
  for (const row of records) {
    assert.ok(runtimeResiliencePatches[Object.keys(runtimeResiliencePatches).find(key => runtimeResiliencePatches[key].id === row.id)].beforeSHA256.includes(row.beforeSHA256))
    assert.notEqual(row.afterSHA256, row.beforeSHA256)
  }
  assert.equal((await readFile(join(modules, '@deepseek-ai/dsh-llm-pi-ai/lib/index.js'), 'utf8')).split('supports at most').length, 2)
  await assert.rejects(patchRuntimeResilience(modules), /input changed/)
})

// Corrupt imported session isolation
const req = runtime && createRequire(join(runtime, 'package.json'))
const load = name => import(pathToFileURL(req.resolve(name)))
const [{ Context }, { sessionFormatCatalog: formats }, { SessionPersistenceCorruptionError }] = runtime
  ? await Promise.all([load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-session-format-catalog'), load('@deepseek-ai/dsh-session-persistence')])
  : [{}, {}, {}]
const original = runtime && await readFile(req.resolve('@deepseek-ai/dsh-session-persistence-jsonl'), 'utf8')
const sessionTest = (name, fn) => test(name, { skip: !runtime }, fn)

async function fixture(t,adapted=true,compression='zstd') {
 const temp=await mkdtemp(join(tmpdir(),'eduwork-session-isolation-'))
 t.after(()=>rm(temp,{recursive:true,force:true}))
 await symlink(join(runtime,'node_modules'),join(temp,'node_modules'))
 const file=join(temp,'backend.mjs');await writeFile(file,adapted?adaptNativeSessionIsolation(original):original)
 const Jsonl=await import(pathToFileURL(file))
 const ctx=new Context(),warnings=[];ctx.logger.warn=message=>warnings.push(message)
 const root=join(temp,'sessions');await ctx.plugin(Jsonl,{root,compression})
 t.after(()=>ctx.fiber.dispose())
 const p=ctx.sessionPersistence
 const write=async(id,cwd,wrong=false)=>{
  const header={version:formats.currentVersion,id,createdAt:100,cwd,isSeeded:false,delegationDepth:0,agentPreset:'standard'}
  const canonical=p.locate(header).path
  const path=wrong?join(root,'--synthetic-中文--',id,`session.v${formats.currentVersion}.jsonl${compression==='zstd'?'.zstd':''}`):canonical
  const raw=Buffer.from(JSON.stringify(formats.encodeCurrentHeader(header,0))+'\n')
  const bytes=compression==='zstd'?zstdCompressSync(raw):raw
  await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes)
  return {path,canonical,bytes,header}
 }
 return {temp,root,p,write,warnings,ctx}
}
sessionTest('original backend reproduces catalog failure on noncanonical Chinese import directory',async t=>{
 const f=await fixture(t,false);await f.write('synthetic-bad',join(f.temp,'中文'),true)
 await assert.rejects(f.p.list(),/corrupt session log.*cwd identify/)
})
for(const compression of ['zstd','none'])sessionTest(`${compression}: healthy sessions survive bad import; warning once and original bytes retained`,async t=>{
 const f=await fixture(t,true,compression)
 await f.write('synthetic-good',join(f.temp,'合法中文'))
 const bad=await f.write('synthetic-bad',join(f.temp,'中文'),true)
 assert.deepEqual((await f.p.list()).map(x=>x.header.id),['synthetic-good'])
 assert.deepEqual((await f.p.list()).map(x=>x.header.id),['synthetic-good'])
 assert.equal(f.warnings.length,1)
 assert.match(f.warnings[0],/original file retained/)
 assert.deepEqual(await readFile(bad.path),bad.bytes)
 await assert.rejects(f.p.open('synthetic-bad','read'),SessionPersistenceCorruptionError)
 // Synthetic offline repair: only relocate the session directory. No event rewrite.
 await mkdir(dirname(dirname(bad.canonical)),{recursive:true})
 await rename(dirname(bad.path),dirname(bad.canonical))
 assert.deepEqual((await f.p.list()).map(x=>x.header.id).sort(),['synthetic-bad','synthetic-good'])
 const handle=await f.p.open('synthetic-bad','read')
 try {assert.equal(handle.header.cwd,bad.header.cwd);await handle.read()}finally{await handle.close()}
 assert.deepEqual(await readFile(bad.canonical),bad.bytes)
})
sessionTest('cancellation and filesystem errors still propagate',async t=>{
 const f=await fixture(t)
 const controller=new AbortController();controller.abort()
 await assert.rejects(f.p.list({signal:controller.signal}),{name:'AbortError'})
 await f.p.list();f.p.listGenerations=async()=>{throw Object.assign(Error('synthetic denied'),{code:'EACCES'})}
 await assert.rejects(f.p.list(),{code:'EACCES'})
})
sessionTest('adaptation refuses a different backend rather than patching unknown code',()=>{
 assert.throws(()=>adaptNativeSessionIsolation('export default class {}'),/Unrecognized/)
 assert.throws(()=>adaptNativeSessionIsolation(adaptNativeSessionIsolation(original)),/Unrecognized/)
})

sessionTest('actual workspace registry starts with one corrupt imported session and one healthy session',async t=>{
 const f=await fixture(t)
 const cwd=join(f.temp,'workspace-中文');await mkdir(cwd)
 await f.write('synthetic-good',cwd)
 await f.write('synthetic-bad',cwd,true)
 const [storage,json,domain,{default:Workspace}]=await Promise.all([load('@deepseek-ai/dsh-storage'),load('@deepseek-ai/dsh-storage-json'),load('@deepseek-ai/dsh-storage-domain'),load('@deepseek-ai/dsh-workspace')])
 await f.ctx.plugin(storage.default)
 await f.ctx.plugin(json,{root:join(f.temp,'storage')})
 await f.ctx.plugin(domain,{backend:'json'})
 await f.ctx.plugin(Workspace)
 assert.ok(f.ctx.workspaceRegistry,'Workspace service is active')
 assert.deepEqual((await f.p.list()).map(x=>x.header.id),['synthetic-good'])
 assert.equal(f.warnings.length,1)
})
