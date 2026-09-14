import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises'
import {join,dirname,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash,randomUUID} from 'node:crypto'
import {renderOfficePreview} from '../packages/artifact-services/lib/office-preview.js'

const html='<!doctype html><html><head></head><body><aside data-office-warning data-office-warning-code="chart">图表 &amp; 字体需核对</aside><main class="slides" data-slide-width="960" data-slide-height="720" data-slide-count="2"><section class="slide-wrap" data-slide-index="1"><div class="slide">第一页</div></section><section class="slide-wrap" data-slide-index="2"><div class="slide">第二页</div></section></main></body></html>'
async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'office-preview-service-test-'))
  t.after(async()=>{assert.equal(dirname(directory),resolve(tmpdir()));await rm(directory,{recursive:true,force:true})})
  const path=join(directory,'slides.pptx'),bytes=Buffer.from(randomUUID())
  await writeFile(path,bytes)
  const calls=[]
  const runtime={environment:{DSH_OFFICE_PYTHON:process.execPath},execFile:(python,args,options,callback)=>{
    calls.push({python,args,options});callback(null,html,'')
  }}
  return {directory,path,bytes,calls,runtime}
}
test('preview identity follows exact file bytes across names, immutable cache values and external warnings',async t=>{
  const f=await fixture(t),first=await renderOfficePreview(f.path,undefined,f.runtime)
  assert.equal(first.description.sourceHash,createHash('sha256').update(f.bytes).digest('hex'))
  assert.equal(first.description.pageWidth,960);assert.equal(first.description.pageHeight,720);assert.equal(first.description.pageCount,2)
  assert.deepEqual(first.description.warnings,[{code:'chart',message:'图表 & 字体需核对'}])
  const alias=join(f.directory,'different-name.pptx');await writeFile(alias,f.bytes)
  const second=await renderOfficePreview(alias,undefined,f.runtime)
  assert.deepEqual(second,first);assert.equal(f.calls.length,1)
  first.description.warnings[0].message='changed client response'
  assert.equal((await renderOfficePreview(alias,undefined,f.runtime)).description.warnings[0].message,'图表 & 字体需核对')
  await rm(alias)
  await assert.rejects(renderOfficePreview(alias,undefined,f.runtime),{code:'ENOENT'})
})
test('changed bytes and font configuration invalidate shared conversion cache',async t=>{
  const f=await fixture(t),first=await renderOfficePreview(f.path,undefined,f.runtime)
  await writeFile(f.path,Buffer.concat([f.bytes,Buffer.from('new version')]))
  const second=await renderOfficePreview(f.path,undefined,f.runtime)
  assert.notEqual(first.description.sourceHash,second.description.sourceHash);assert.notEqual(first.description.cacheKey,second.description.cacheKey)
  f.runtime.environment.DSH_OFFICE_FONT_FINGERPRINT='font-installation-v2'
  const third=await renderOfficePreview(f.path,undefined,f.runtime)
  assert.equal(second.description.sourceHash,third.description.sourceHash);assert.notEqual(second.description.fontFingerprint,third.description.fontFingerprint);assert.notEqual(second.description.cacheKey,third.description.cacheKey)
  assert.equal(f.calls.length,3)
})
test('converter consumes immutable source snapshot matching hash and cleans it afterwards',async t=>{
  const f=await fixture(t);let snapshot
  f.runtime.execFile=(python,args,options,callback)=>{snapshot=args.at(-1);void (async()=>{
    assert.notEqual(snapshot,f.path);await writeFile(f.path,'changed while rendering')
    assert.deepEqual(await readFile(snapshot),f.bytes);assert.equal(options.windowsHide,true)
    callback(null,html,'')
  })().catch(error=>callback(error,'',''))}
  const result=await renderOfficePreview(f.path,undefined,f.runtime)
  assert.equal(result.description.sourceHash,createHash('sha256').update(f.bytes).digest('hex'))
  await assert.rejects(stat(snapshot),{code:'ENOENT'})
})
test('cancelled requests and failed conversions do not return or populate a cached success',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort()
  await assert.rejects(renderOfficePreview(f.path,controller.signal,f.runtime),{name:'AbortError'});assert.equal(f.calls.length,0)
  const success=f.runtime.execFile
  f.runtime.execFile=(python,args,options,callback)=>callback(new Error('failure'),'','conversion failed')
  await assert.rejects(renderOfficePreview(f.path,undefined,f.runtime),/conversion failed/)
  f.runtime.execFile=success;await renderOfficePreview(f.path,undefined,f.runtime);assert.equal(f.calls.length,1)
  await assert.rejects(renderOfficePreview(f.path,controller.signal,f.runtime),{name:'AbortError'})
})
