import test from 'node:test'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,symlink,readdir,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import JSZip from 'jszip'
import {runOffice,normalizeOfficeRequest,renderOfficePreview} from '../packages/artifact-services/lib/office.js'
import {SpeechService} from '../packages/artifact-services/lib/speech.js'
import {MediaProviders} from '../packages/artifact-services/lib/providers.js'
import {loadMusicCatalog,defaultMusicRoot} from '../packages/artifact-services/lib/music.js'
import {createMediaJobDirectory,assertWithinWorkspace} from '../packages/artifact-services/lib/media-paths.js'

const makeRoot=()=>mkdtemp(join(tmpdir(),'shared-services-'))
const call=(root,format,args)=>runOffice({projectPath:root,request:normalizeOfficeRequest(format,args)})

test('media output rejects an external workspace junction before creating anything through it',async()=>{
 const root=await makeRoot(),external=await makeRoot()
 await symlink(external,join(root,'.artifacts'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(createMediaJobDirectory(root),/outside workspace/)
 assert.deepEqual(await readdir(external),[])
 assert.equal(assertWithinWorkspace(root,join(root,'..file.wav')),'..file.wav')
 const ordinary=await makeRoot(),directory=await createMediaJobDirectory(ordinary)
 assert.ok(assertWithinWorkspace(await realpath(ordinary),directory).includes('media'))
})

test('shared Office preserves document editing and preview without Studio or campus assets',async()=>{
 const root=await makeRoot()
 await call(root,'document',{action:'create',output_path:'input.docx',spec:{blocks:[{type:'paragraph',runs:[{text:'Original',bold:true}]}]}})
 await call(root,'document',{action:'edit',input_path:'input.docx',output_path:'edited.docx',spec_json:JSON.stringify({operations:[{op:'replace_text',find:'Original',replace:'Revised'}]})})
 const check=await call(root,'document',{action:'validate',input_path:'edited.docx'});assert.equal(check.report.valid,true)
 const preview=await renderOfficePreview(join(root,'edited.docx'));assert.match(preview.html,/Revised/)
 const original=await renderOfficePreview(join(root,'input.docx'));assert.match(original.html,/Original/)
 await assert.rejects(call(root,'document',{action:'create',output_path:'input.docx',spec_json:'{"blocks":[]}'}),/exists|blocks/)
 assert.throws(()=>normalizeOfficeRequest('document',{action:'create',output_path:'../outside.docx',spec_json:'{}'}),/inside/)
})

test('shared spreadsheet create and edit distinguish literal text from formulas',async()=>{
 const root=await makeRoot()
 await call(root,'spreadsheet',{action:'create',output_path:'input.xlsx',spec_json:JSON.stringify({sheets:[{name:'Data',rows:[[{type:'text',value:'=SUM(1,2)'},{type:'formula',value:'=SUM(1,2)'},3]]}]})})
 await call(root,'spreadsheet',{action:'edit',input_path:'input.xlsx',output_path:'edited.xlsx',spec_json:JSON.stringify({operations:[{op:'set',sheet:'Data',cell:'C1',value:{type:'text',value:'=literal'}},{op:'append_rows',sheet:'Data',rows:[[{type:'text',value:'=second'}]]}]})})
 const zip=await JSZip.loadAsync(await readFile(join(root,'edited.xlsx'))),xml=await zip.file('xl/worksheets/sheet1.xml').async('string')
 assert.equal((xml.match(/<f>/g)||[]).length,1);assert.match(xml,/=literal/);assert.match(xml,/=second/)
 assert.equal((await call(root,'spreadsheet',{action:'validate',input_path:'edited.xlsx'})).report.valid,true)
})

test('shared PPTX includes full speaker notes and accepts an unbranded external deck',async()=>{
 const root=await makeRoot(),notes='完整讲者备注。'.repeat(60)
 await assert.rejects(call(root,'presentation',{action:'create',output_path:'invalid-note.pptx',spec:{slides:[{layout:'two-column',title:'说明',left:{heading:'甲',bullets:['内容']},right:{heading:'乙',bullets:['内容']},note:'必须显示的补充说明'}]}}),/two-column has no visible note field.*left.bullets/)
 await call(root,'presentation',{action:'create',output_path:'notes.pptx',spec_json:JSON.stringify({theme:'modern-clean',slides:[{layout:'summary',title:'共享组件',bullets:['真实文件生成','统一应用接口'],speaker_notes:notes}]})})
 assert.equal((await call(root,'presentation',{action:'validate',input_path:'notes.pptx'})).report.valid,true)
 const inspected=await call(root,'presentation',{action:'inspect',input_path:'notes.pptx'})
 assert.equal(inspected.report.slides[0].speaker_notes,notes)
 execFileSync(process.env.DSH_OFFICE_PYTHON,['-I','-c',"import sys; from pptx import Presentation; p=Presentation(); s=p.slides.add_slide(p.slide_layouts[0]); s.shapes.title.text='External deck'; p.save(sys.argv[1])",join(root,'external.pptx')],{windowsHide:true})
 const validation=await call(root,'presentation',{action:'validate',input_path:'external.pptx'});assert.equal(validation.report.valid,true)
})

test('shared PDF keeps create, merge, extract and inspection',async()=>{
 const root=await makeRoot()
 for(const name of ['one','two'])await call(root,'pdf',{action:'create',output_path:name+'.pdf',spec_json:JSON.stringify({title:name,blocks:[{type:'paragraph',text:name}]})})
 await call(root,'pdf',{action:'merge',output_path:'merged.pdf',input_paths_json:'["one.pdf","two.pdf"]'})
 await call(root,'pdf',{action:'extract',input_path:'merged.pdf',output_path:'page.pdf',pages:'2'})
 const report=(await call(root,'pdf',{action:'inspect',input_path:'page.pdf'})).report
 assert.equal(report.ok,true);assert.match(JSON.stringify(report),/two/)
 assert.equal((await call(root,'pdf',{action:'validate',input_path:'page.pdf'})).report.valid,true)
})

test('third-party speech uses the same request; failure, cancellation and unload never select another provider',async()=>{
 const root=await makeRoot(),file=join(root,'speech.wav'),wav=Buffer.alloc(44+1600)
 wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);await writeFile(file,wav)
 const service=new SpeechService(),calls=[],signal=new AbortController()
 const dispose=service.register({id:'third-party',title:'Third party',local:false,secret:'private',voices:async()=>[{id:'custom',title:'Custom'}],
  synthesize:async request=>{calls.push(request);return {path:file,duration:999,secret:'vendor-private'}}})
 service.register({id:'local',title:'Local',local:true,voices:async()=>[{id:'one',title:'One'}],synthesize:async()=>{throw new Error('must not fall back')}})
 const result=await service.synthesize({provider:'third-party',voice:'custom',text:'Exact text',speed:1,signal:signal.signal,execution:{token:'parent'}})
 assert.equal(result.provider,'third-party');assert.equal(result.duration,.1);assert.equal(calls[0].text,'Exact text');assert.equal(calls[0].execution.token,'parent')
 service.register({id:'unavailable',voices:async()=>{throw new Error('private-credentials')},synthesize:async()=>{throw new Error('unused')}})
 assert.ok(!JSON.stringify(await service.list()).includes('private'));assert.equal(result.secret,undefined)
 await assert.rejects(service.synthesize({provider:'third-party',voice:'missing',text:'text'}),/音色不可用/)
 signal.abort();await assert.rejects(service.synthesize({provider:'third-party',text:'text',signal:signal.signal}))
 dispose();await assert.rejects(service.synthesize({provider:'third-party',text:'text'}),/不可用/);assert.equal(calls.length,1)
})

test('six shared MP3 tracks retain provenance, integrity and decoded loop validation',async()=>{
 const providers=new MediaProviders();const dispose=await loadMusicCatalog(providers)
 const catalog=JSON.parse(await readFile(join(defaultMusicRoot,'catalog.json'),'utf8'))
 assert.equal(catalog.tracks.length,6);assert.equal((await providers.describe()).music.length,6)
 for(const track of catalog.tracks){
  const bytes=await readFile(join(defaultMusicRoot,track.filename))
  assert.equal(createHash('sha256').update(bytes).digest('hex'),track.sha256)
  assert.equal(bytes.toString('ascii',0,3),'ID3');assert.equal(track.validation.clippedSamples,0)
  assert.equal(track.encoding.bitrateKbps,192);assert.equal(providers.music(track.id).mime,'mpeg')
  assert.match(track.pcmMaster.sha256,/^[a-f0-9]{64}$/)
  assert.ok(track.source&&track.generation&&track.license);assert.ok(track.durationSeconds>=30)
  assert.equal(track.validation.durationSeconds,track.durationSeconds)
  assert.ok(track.validation.loopSeamPeak<0.03)
 }
 dispose();assert.equal((await providers.describe()).music.length,0)
})
