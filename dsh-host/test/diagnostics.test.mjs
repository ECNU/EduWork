import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inflateRawSync, crc32 } from 'node:zlib'
import { exportDiagnostics, redactDiagnostic } from '../diagnostics.mjs'
import { desktopLogger } from '../desktop-log.mjs'

function unzip(base64) {
  const archive = Buffer.from(base64,'base64'), result = new Map(); let offset = 0
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const length = archive.readUInt32LE(offset+18), nameLength = archive.readUInt16LE(offset+26), extra = archive.readUInt16LE(offset+28)
    const name = archive.subarray(offset+30,offset+30+nameLength).toString('utf8'), start=offset+30+nameLength+extra
    const bytes = inflateRawSync(archive.subarray(start,start+length))
    assert.equal(crc32(bytes), archive.readUInt32LE(offset+14)); assert.equal(bytes.length, archive.readUInt32LE(offset+22))
    result.set(name,bytes.toString('utf8'));offset=start+length
  }
  assert.equal(archive.readUInt32LE(offset),0x02014b50)
  return result
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'eduwork-diagnostic-中文 '))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const logs=join(root,'logs'),product=join(root,'product'),home=join(root,'data/dsh'),config=join(root,'config/eduwork.jsonc')
  for(const path of [logs,product,home,join(root,'config'),join(product,'d/node_modules/@eduwork/example')])await mkdir(path,{recursive:true})
  await writeFile(config,JSON.stringify({schemaVersion:1,organizations:[]}))
  await writeFile(join(product,'assembly.json'),JSON.stringify({version:'0.3.5',dshVersion:'0.1.5-rc.2',distribution:'eduwork',secret:'do-not-copy'}))
  await writeFile(join(product,'d/package.json'),JSON.stringify({dependencies:{'@eduwork/example':'1.2.3'}}))
  await writeFile(join(product,'d/node_modules/@eduwork/example/package.json'),JSON.stringify({name:'@eduwork/example',version:'1.2.3',private:'do-not-copy'}))
  return {root,logs,product,home,config,version:'0.3.5',shell:'electron'}
}

test('both shells export a readable ZIP with versions, redacted real log text and explicit missing markers',async t=>{
  const args=await fixture(t)
  await writeFile(join(args.logs,'desktop-host.log'), '模型接口失败：duplicate field `reasoning`\nAuthorization: Bearer <synthetic-secret>\n'+JSON.stringify({message:'HTTP 400',requestBody:{messages:['private-prompt']},access_token:'synthetic-secret'})+'\n')
  await writeFile(join(args.home,'.eduwork-migration.json'),JSON.stringify({schemaVersion:1,completedAt:'2026-01-01',imported:12,source:'/private/source'}))
  await writeFile(join(args.logs,'credentials.json'),'must-not-read')
  for(const shell of ['wails','electron']) {
    const result=await exportDiagnostics({...args,shell}), files=unzip(result.archive)
    assert.match(result.filename,/^EduWork-diagnostics-[\w-]+\.zip$/)
    assert.equal(JSON.parse(files.get('summary.json')).shell,shell)
    assert.match(files.get('logs/desktop-host.log'),/duplicate field `reasoning`/)
    assert.match(files.get('logs/desktop-host.log'),/HTTP 400/)
    assert.deepEqual(JSON.parse(files.get('components.json')),[{name:'@eduwork/example',version:'1.2.3'}])
    assert.equal(JSON.parse(files.get('metadata/migration.json')).imported,12)
    assert.doesNotMatch([...files.values()].join('\n'),/synthetic-secret|private-prompt|do-not-copy|must-not-read|\/private\/source/)
    assert.equal(JSON.parse(result.report).files.find(f=>f.name==='logs/startup-error.log').status,'missing')
    assert.ok(files.has('README.txt'))
  }
})
test('diagnostics survives broken configuration, oversized logs and redirected directories',async t=>{
  const args=await fixture(t)
  await writeFile(args.config,'{"schemaVersion":1, BROKEN')
  await writeFile(join(args.logs,'desktop-host.log'),'x'.repeat(700*1024)+'\n最后一条：中文错误\n')
  await mkdir(join(args.logs,'host.log'))
  const output=await exportDiagnostics(args), files=unzip(output.archive), report=JSON.parse(output.report)
  assert.equal(JSON.parse(files.get('configuration.json')).valid,false)
  assert.match(files.get('logs/desktop-host.log'),/最后一条：中文错误/)
  assert.ok(report.files.find(f=>f.name==='logs/desktop-host.log').truncated)
  assert.equal(report.files.find(f=>f.name==='logs/host.log').status,'not-regular')
  const outside=await mkdtemp(join(tmpdir(),'eduwork-outside-'))
  t.after(()=>rm(outside,{recursive:true,force:true}))
  await writeFile(join(outside,'release.json'),'sensitive-test')
  await symlink(outside,join(args.root,'redirect'),process.platform==='win32'?'junction':'dir')
  // A product nested path through a junction must never escape the owned root.
  await mkdir(join(args.product,'d'),{recursive:true})
  await symlink(outside,join(args.product,'d/node_modules/outside'),process.platform==='win32'?'junction':'dir')
  await writeFile(join(args.product,'d/package.json'),JSON.stringify({dependencies:{outside:'1'}}))
  await writeFile(join(outside,'package.json'),JSON.stringify({version:'sensitive-test'}))
  assert.doesNotMatch([...unzip((await exportDiagnostics(args)).archive).values()].join('\n'),/sensitive-test/)
})
test('log redaction handles header, multiline JSON, callback URL, JWT and UTF-8 paths',()=>{
  const text='Authorization: Bearer abc-example\n"refresh_token": "def-example",\nhttps://id.example/cb?code=code-example&state=state-example\nBearer xyz-example\n'+JSON.stringify({message:'invalid_request_error',messages:[{content:'private text'}],api_key:'key-example'})+'\nC:\\Users\\Test\\项目\\app.js'
  const result=redactDiagnostic(text,{PROGRAM:'C:\\Users\\Test\\项目'})
  assert.doesNotMatch(result,/abc-example|def-example|code-example|state-example|xyz-example|key-example|private text/)
  assert.match(result,/invalid_request_error/); assert.match(result,/<PROGRAM>/)
})
test('desktop logger persists startup/Host text and rotates bounded files',async t=>{
  const {logs}=await fixture(t), file=join(logs,'desktop-host.log'), log=desktopLogger(file)
  log('启动完成\n'); assert.match(await readFile(file,'utf8'),/启动完成/)
  await writeFile(file,'x'.repeat(2*1024*1024+1)); log('new entry\n')
  assert.equal(await readFile(file,'utf8'),'new entry\n')
  assert.ok((await readFile(file+'.1')).length>2*1024*1024)
})
